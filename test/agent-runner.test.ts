import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '../src/agent-runner';
import { InMemoryAgentActionStore } from '../src/agent-action-store-in-memory';
import { ToolRegistry } from '../src/tools';
import { SecurityAuditLog } from '../src/security-audit-log';
import type { AgentAction, AgentActionStore, AgentDefinition, AgentDraftOutput } from '../src/agent-types';
import type { LLMProvider } from '../src/types';

// securityAuditLog is a mandatory ToolRegistry constructor argument. AgentRunner
// always supplies a TenantContext to every toolRegistry.execute() call (see
// agent-runner.ts), so these tests exercise the default tenantScoped: true
// path and never trip the missing-tenant-context check — a no-op store is
// fine here since no test in this file asserts on audit-log behavior.
const testAuditLog = new SecurityAuditLog({
  store: async () => {},
  onCriticalViolation: async () => {},
});

interface FakeInput {
  donorName: string;
  amount: number;
}

function makeDefinition(overrides: Partial<AgentDefinition<FakeInput>> = {}): AgentDefinition<FakeInput> {
  return {
    id: 'test-agent',
    sourceType: 'test_source',
    buildPrompt: (input) => ({
      systemPrompt: 'Draft a thank-you note.',
      userPrompt: `Donor: ${input.donorName}, amount: ${input.amount}`,
    }),
    parseOutput: (raw) => JSON.parse(raw) as AgentDraftOutput,
    action: {
      name: 'send-test-action',
      description: 'Sends the test action',
      parameters: { type: 'object', properties: {} },
    },
    buildToolArgs: (draft) => ({ content: draft.draftContent }),
    checkAutonomy: async () => 'confirm',
    ...overrides,
  };
}

function makeLLM(response: string | Error): LLMProvider {
  return {
    call: vi.fn().mockImplementation(async () => {
      if (response instanceof Error) throw response;
      return { content: response };
    }),
  };
}

describe('AgentRunner.run', () => {
  it('skips entirely when autonomy is off, making no LLM call', async () => {
    const llm = makeLLM('{"draftContent":"hi","sourceSnapshot":{}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition({ checkAutonomy: async () => 'off' });

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('skipped_off');
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('skips when the source was already claimed', async () => {
    const llm = makeLLM('{"draftContent":"hi","sourceSnapshot":{}}');
    const store = new InMemoryAgentActionStore();
    await store.claim({ tenantId: 'tenant-1', agentId: 'test-agent', sourceType: 'test_source', sourceId: 'sub-1' });
    const registry = new ToolRegistry(undefined, testAuditLog);
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('skipped_already_claimed');
  });

  it('writes a pending_confirm action on a successful draft when autonomy is confirm', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('pending_confirm');
    expect(result.action?.draftContent).toBe('Thanks Ada!');
    expect(result.action?.sourceSnapshot).toEqual({ amount: 10 });
  });

  it('sets draft_failed and increments attemptCount when the LLM call throws, below the retry cap', async () => {
    const llm = makeLLM(new Error('LLM timeout'));
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const onError = vi.fn();
    const runner = new AgentRunner(llm, registry, store, onError);
    const definition = makeDefinition();

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('draft_failed');
    expect(result.action?.attemptCount).toBe(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'test-agent', tenantId: 'tenant-1' })
    );
  });

  it('sets draft_failed when parseOutput throws on malformed JSON', async () => {
    const llm = makeLLM('not valid json at all');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('draft_failed');
  });

  it('sets draft_failed when enrichSnapshot throws, exactly like a parseOutput throw', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition({
      enrichSnapshot: () => {
        throw new Error('enrichSnapshot boom');
      },
    });

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('draft_failed');
    expect(result.action?.attemptCount).toBe(1);
  });

  it('escalates enrichSnapshot failures to needs_attention once attemptCount reaches maxAttempts', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const runner = new AgentRunner(llm, registry, store, undefined, 3);
    const definition = makeDefinition({
      enrichSnapshot: () => {
        throw new Error('enrichSnapshot boom');
      },
    });

    const claimed = await store.claim({
      tenantId: 'tenant-1',
      agentId: 'test-agent',
      sourceType: 'test_source',
      sourceId: 'sub-1',
    });
    await store.update(claimed!.id, { status: 'draft_failed', attemptCount: 2 });

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('needs_attention');
    expect(result.action?.attemptCount).toBe(3);
  });

  it('uses enrichSnapshot\'s return value as the persisted sourceSnapshot when autonomy is confirm', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition({
      enrichSnapshot: (input, draft) => ({ ...draft.sourceSnapshot, donorName: input.donorName }),
    });

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('pending_confirm');
    expect(result.action?.sourceSnapshot).toEqual({ amount: 10, donorName: 'Ada' });
  });

  it('leaves sourceSnapshot exactly as parsed when enrichSnapshot is absent (backward compatibility)', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const runner = new AgentRunner(llm, registry, store);
    // No enrichSnapshot on this definition. If it were ever invoked despite
    // being absent, there is no hook to invoke — this test instead proves
    // the model's raw sourceSnapshot passes through untouched, rather than
    // being replaced by some hypothetical would-be-enriched value like
    // { amount: 10, donorName: 'Ada' }.
    const definition = makeDefinition();

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('pending_confirm');
    expect(result.action?.sourceSnapshot).toEqual({ amount: 10 });
    expect(result.action?.sourceSnapshot).not.toEqual({ amount: 10, donorName: 'Ada' });
  });

  it('escalates to needs_attention once attemptCount reaches maxAttempts', async () => {
    const llm = makeLLM(new Error('LLM timeout'));
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const runner = new AgentRunner(llm, registry, store, undefined, 3);
    const definition = makeDefinition();

    // Simulate the cron job's own re-claim-by-id retry: directly set the row
    // to draft_failed with attemptCount 2 before the 3rd run, matching the
    // shape a real Drizzle store would have at this point in the scenario
    // (claim() is a true insert-or-null now, so a retried row is always
    // draft_failed, never left at processing). AgentRunner itself only ever
    // increments by 1 per call.
    const claimed = await store.claim({
      tenantId: 'tenant-1',
      agentId: 'test-agent',
      sourceType: 'test_source',
      sourceId: 'sub-1',
    });
    await store.update(claimed!.id, { status: 'draft_failed', attemptCount: 2 });

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('needs_attention');
    expect(result.action?.attemptCount).toBe(3);
  });

  it('does not reprocess a row already at needs_attention status: no further LLM call, no infinite retry', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    // Get a row into terminal needs_attention state first, mirroring how
    // test 6 sets up attemptCount via claim() + update() — but explicitly
    // setting status: 'needs_attention' this time, not just attemptCount.
    const claimed = await store.claim({
      tenantId: 'tenant-1',
      agentId: 'test-agent',
      sourceType: 'test_source',
      sourceId: 'sub-1',
    });
    await store.update(claimed!.id, { status: 'needs_attention', attemptCount: 3 });

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    // With the store-level fix, claim() itself now excludes needs_attention
    // rows and returns null for them, so run() short-circuits at the
    // pre-existing "already claimed" branch and never reaches the LLM call
    // or the runner's own defense-in-depth check below. Either way, the
    // critical property holds: the LLM is never called again, and the row
    // is never silently reprocessed forever.
    expect(result.status).toBe('skipped_already_claimed');
    expect(llm.call).not.toHaveBeenCalled();

    // The underlying row itself remains untouched at needs_attention.
    const stored = await store.get(claimed!.id);
    expect(stored?.status).toBe('needs_attention');
    expect(stored?.attemptCount).toBe(3);
  });

  it('AgentRunner defense-in-depth: if a store implementation ever (re-)returns a needs_attention row from claim(), run() still refuses to call the LLM and returns needs_attention immediately', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const registry = new ToolRegistry(undefined, testAuditLog);
    const definition = makeDefinition();

    const needsAttentionAction: AgentAction = {
      id: 'action-1',
      tenantId: 'tenant-1',
      agentId: 'test-agent',
      sourceType: 'test_source',
      sourceId: 'sub-1',
      status: 'needs_attention',
      draftContent: null,
      sourceSnapshot: null,
      attemptCount: 3,
      confirmedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // A deliberately non-compliant store stand-in: unlike
    // InMemoryAgentActionStore, its claim() does NOT exclude needs_attention
    // rows. This isolates and proves AgentRunner's own defense-in-depth
    // check, independent of whether the store gates correctly.
    const laxStore: AgentActionStore = {
      claim: async () => needsAttentionAction,
      reclaimForRetry: async () => null,
      update: async () => needsAttentionAction,
      get: async () => needsAttentionAction,
    };

    const runner = new AgentRunner(llm, registry, laxStore);

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('needs_attention');
    expect(result.action).toBe(needsAttentionAction);
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('near-simultaneous run() calls for the same source result in exactly one claim, not two drafts', async () => {
    // Fires both calls without awaiting between them, so both reach
    // store.claim() before either's promise resolves — the async
    // interleaving a real concurrent cron overlap would produce, not a
    // sequential call-then-call. The InMemoryAgentActionStore's claim() is
    // synchronous-under-the-hood (a single Map/Set check-and-set with no
    // await in between), so this exercises the same race a real DB's
    // UNIQUE-constraint-backed claim must also survive — Task 7's
    // DrizzleAgentActionStore relies on Postgres's real UNIQUE constraint
    // for the same guarantee, which this in-memory test cannot itself prove
    // at the DB level, only at this application-level claim contract.
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    const [first, second] = await Promise.all([
      runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1'),
      runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1'),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(['pending_confirm', 'skipped_already_claimed']);
  });

  it('executes the tool and writes auto_sent when autonomy is auto and the tool succeeds', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    registry.register({
      definition: {
        name: 'send-test-action',
        description: 'Sends the test action',
        parameters: { type: 'object', properties: { content: { type: 'string' } } },
      },
      handler: async (_userId, args) => `sent: ${(args as { content: string }).content}`,
    });
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition({ checkAutonomy: async () => 'auto' });

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('auto_sent');
    expect(result.action?.draftContent).toBe('Thanks Ada!');
  });

  it('uses enrichSnapshot\'s return value as the persisted sourceSnapshot when autonomy is auto', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    registry.register({
      definition: {
        name: 'send-test-action',
        description: 'Sends the test action',
        parameters: { type: 'object', properties: { content: { type: 'string' } } },
      },
      handler: async (_userId, args) => `sent: ${(args as { content: string }).content}`,
    });
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition({
      checkAutonomy: async () => 'auto',
      enrichSnapshot: (input, draft) => ({ ...draft.sourceSnapshot, donorName: input.donorName }),
    });

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('auto_sent');
    expect(result.action?.sourceSnapshot).toEqual({ amount: 10, donorName: 'Ada' });
  });

  it('writes send_failed when autonomy is auto and the tool execution fails', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    registry.register({
      definition: {
        name: 'send-test-action',
        description: 'Sends the test action',
        parameters: { type: 'object', properties: { content: { type: 'string' } } },
      },
      handler: async () => {
        throw new Error('email provider down');
      },
    });
    const onError = vi.fn();
    const runner = new AgentRunner(llm, registry, store, onError);
    const definition = makeDefinition({ checkAutonomy: async () => 'auto' });

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('send_failed');
    expect(onError).toHaveBeenCalled();
  });
});

describe('AgentRunner.run — buildDraft path', () => {
  it('uses buildDraft directly and never calls the LLM when buildDraft is present', async () => {
    const llmProvider: LLMProvider = { call: vi.fn().mockRejectedValue(new Error('LLM should not be called')) };
    const toolRegistry = new ToolRegistry(undefined, testAuditLog);
    const store = new InMemoryAgentActionStore();
    const runner = new AgentRunner(llmProvider, toolRegistry, store);

    const draft: AgentDraftOutput = { draftContent: 'Deterministic notification text', sourceSnapshot: {} };
    const definition: AgentDefinition<{ caseId: string }> = {
      id: 'automation:def1',
      sourceType: 'case',
      buildPrompt: () => {
        throw new Error('buildPrompt should not be called when buildDraft is present');
      },
      parseOutput: () => {
        throw new Error('parseOutput should not be called when buildDraft is present');
      },
      buildDraft: () => draft,
      action: { name: 'notify_case_owner', description: 'notify', parameters: {} },
      buildToolArgs: (d) => ({ text: d.draftContent }),
      checkAutonomy: async () => 'confirm',
    };

    const result = await runner.run(definition, { caseId: 'c1' }, 't1', 'c1');

    expect(llmProvider.call).not.toHaveBeenCalled();
    expect(result.status).toBe('pending_confirm');
    expect(result.action?.draftContent).toBe('Deterministic notification text');
  });

  it('falls back to reclaimForRetry when claim returns null, and re-drafts', async () => {
    // Uses a hand-rolled store stand-in (like the existing "laxStore"
    // defense-in-depth test above) rather than InMemoryAgentActionStore,
    // because InMemoryAgentActionStore's own claim() already re-returns a
    // draft_failed/attemptCount>0 row directly (see agent-action-store-in-memory.ts),
    // so it never actually returns null for that scenario — run()'s
    // reclaimForRetry fallback would never be exercised. This isolates and
    // proves run() itself calls reclaimForRetry with the right params
    // whenever claim() returns null, independent of any one store's
    // internal claim() retry behavior (e.g. the future Drizzle-backed store
    // from Task 7, whose claim() relies on a real UNIQUE constraint and
    // always returns null on conflict, regardless of attemptCount).
    const llmProvider: LLMProvider = { call: vi.fn() };
    const toolRegistry = new ToolRegistry(undefined, testAuditLog);

    const existingAction: AgentAction = {
      id: 'action-1',
      tenantId: 't1',
      agentId: 'automation:def1',
      sourceType: 'case',
      sourceId: 'c1',
      status: 'draft_failed',
      draftContent: 'old draft',
      sourceSnapshot: {},
      attemptCount: 1,
      confirmedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const claimSpy = vi.fn().mockResolvedValue(null);
    const reclaimSpy = vi.fn().mockResolvedValue({ ...existingAction, status: 'processing' });
    const updateSpy = vi.fn().mockImplementation(async (id: string, patch: Partial<AgentAction>) => ({
      ...existingAction,
      ...patch,
      id,
    }));
    const fakeStore: AgentActionStore = {
      claim: claimSpy,
      reclaimForRetry: reclaimSpy,
      update: updateSpy,
      get: vi.fn().mockResolvedValue(existingAction),
    };

    const runner = new AgentRunner(llmProvider, toolRegistry, fakeStore, undefined, 3);

    const draft: AgentDraftOutput = { draftContent: 'retried draft', sourceSnapshot: {} };
    const definition: AgentDefinition<{ caseId: string }> = {
      id: 'automation:def1',
      sourceType: 'case',
      buildPrompt: () => {
        throw new Error('unused');
      },
      parseOutput: () => {
        throw new Error('unused');
      },
      buildDraft: () => draft,
      action: { name: 'notify_case_owner', description: 'notify', parameters: {} },
      buildToolArgs: (d) => ({ text: d.draftContent }),
      checkAutonomy: async () => 'confirm',
    };

    const result = await runner.run(definition, { caseId: 'c1' }, 't1', 'c1');

    expect(claimSpy).toHaveBeenCalledTimes(1);
    expect(reclaimSpy).toHaveBeenCalledWith({
      tenantId: 't1',
      agentId: 'automation:def1',
      sourceType: 'case',
      sourceId: 'c1',
      maxAttempts: 3,
    });
    expect(result.status).toBe('pending_confirm');
    expect(result.action?.draftContent).toBe('retried draft');
  });

  it('returns skipped_already_claimed when the row exists and is not reclaimable (e.g. still processing)', async () => {
    const llmProvider: LLMProvider = { call: vi.fn() };
    const toolRegistry = new ToolRegistry(undefined, testAuditLog);
    const store = new InMemoryAgentActionStore();
    const runner = new AgentRunner(llmProvider, toolRegistry, store);

    const definition: AgentDefinition<{ caseId: string }> = {
      id: 'automation:def1',
      sourceType: 'case',
      buildPrompt: () => {
        throw new Error('unused');
      },
      parseOutput: () => {
        throw new Error('unused');
      },
      buildDraft: () => ({ draftContent: 'x', sourceSnapshot: {} }),
      action: { name: 'notify_case_owner', description: 'notify', parameters: {} },
      buildToolArgs: (d) => ({ text: d.draftContent }),
      checkAutonomy: async () => 'confirm',
    };

    // First run() succeeds and leaves the row at pending_confirm, not
    // draft_failed — so it is not reclaimable.
    const first = await runner.run(definition, { caseId: 'c2' }, 't1', 'c2');
    expect(first.status).toBe('pending_confirm');

    const second = await runner.run(definition, { caseId: 'c2' }, 't1', 'c2');

    expect(second.status).toBe('skipped_already_claimed');
  });

  it('existing buildPrompt/parseOutput path is unaffected when buildDraft is absent', async () => {
    const llmProvider: LLMProvider = {
      call: vi.fn().mockResolvedValue({ content: '{"draftContent":"llm text","sourceSnapshot":{}}' }),
    };
    const toolRegistry = new ToolRegistry(undefined, testAuditLog);
    const store = new InMemoryAgentActionStore();
    const runner = new AgentRunner(llmProvider, toolRegistry, store);

    const definition: AgentDefinition<{ x: string }> = {
      id: 'donor-response',
      sourceType: 'donation',
      buildPrompt: () => ({ systemPrompt: 'sys', userPrompt: 'user' }),
      parseOutput: (raw) => JSON.parse(raw) as AgentDraftOutput,
      action: { name: 'send-donor-followup', description: 'send', parameters: {} },
      buildToolArgs: (d) => ({ text: d.draftContent }),
      checkAutonomy: async () => 'confirm',
    };

    const result = await runner.run(definition, { x: 'y' }, 't1', 'd1');

    expect(llmProvider.call).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('pending_confirm');
  });
});

describe('AgentRunner.confirmAndExecute', () => {
  it('executes the tool with the original draft content and marks the action sent', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    let capturedArgs: unknown;
    registry.register({
      definition: {
        name: 'send-test-action',
        description: 'Sends the test action',
        parameters: { type: 'object', properties: { content: { type: 'string' } } },
      },
      handler: async (_userId, args) => {
        capturedArgs = args;
        return 'ok';
      },
    });
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    const pending = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');
    const confirmed = await runner.confirmAndExecute(definition, pending.action!.id, 'tenant-1', 'staff-user-1');

    expect(confirmed.status).toBe('sent');
    expect(confirmed.confirmedByUserId).toBe('staff-user-1');
    expect((capturedArgs as { content: string }).content).toBe('Thanks Ada!');
  });

  it('uses editedContent in place of the original draft when provided, and marks edited_and_sent', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    let capturedArgs: unknown;
    registry.register({
      definition: {
        name: 'send-test-action',
        description: 'Sends the test action',
        parameters: { type: 'object', properties: { content: { type: 'string' } } },
      },
      handler: async (_userId, args) => {
        capturedArgs = args;
        return 'ok';
      },
    });
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    const pending = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');
    const confirmed = await runner.confirmAndExecute(definition, pending.action!.id, 'tenant-1', 'staff-user-1', {
      editedContent: 'Thanks so much, Ada, edited by staff!',
    });

    expect(confirmed.status).toBe('edited_and_sent');
    expect((capturedArgs as { content: string }).content).toBe('Thanks so much, Ada, edited by staff!');
  });

  it('marks send_failed (not thrown) when the tool execution fails during confirm', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    registry.register({
      definition: {
        name: 'send-test-action',
        description: 'Sends the test action',
        parameters: { type: 'object', properties: { content: { type: 'string' } } },
      },
      handler: async () => {
        throw new Error('email provider down');
      },
    });
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    const pending = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');
    const result = await runner.confirmAndExecute(definition, pending.action!.id, 'tenant-1', 'staff-user-1');

    expect(result.status).toBe('send_failed');
  });

  it('throws if the actionId does not exist', async () => {
    const llm = makeLLM('{}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    await expect(
      runner.confirmAndExecute(definition, 'does-not-exist', 'tenant-1', 'staff-user-1')
    ).rejects.toThrow();
  });

  it('throws the identical "AgentAction not found" error (not a distinct message) when the action exists but belongs to a different tenant, and never executes the tool or updates the action', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    registry.register({
      definition: {
        name: 'send-test-action',
        description: 'Sends the test action',
        parameters: { type: 'object', properties: { content: { type: 'string' } } },
      },
      handler: async () => 'ok',
    });
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    // Action is genuinely created and persisted under tenant-1.
    const pending = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    // Spy only after the setup run() above, so these spies capture exactly
    // what confirmAndExecute itself does, not the writes run() made.
    const executeSpy = vi.spyOn(registry, 'execute');
    const updateSpy = vi.spyOn(store, 'update');

    // A different tenant (tenant-2) attempts to confirm tenant-1's action.
    await expect(
      runner.confirmAndExecute(definition, pending.action!.id, 'tenant-2', 'staff-user-1')
    ).rejects.toThrow(`AgentAction not found: ${pending.action!.id}`);

    expect(executeSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('AgentRunner.reject', () => {
  it('marks the action rejected without executing the tool', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const executeSpy = vi.spyOn(registry, 'execute');
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    const pending = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');
    const rejected = await runner.reject(pending.action!.id, 'tenant-1');

    expect(rejected.status).toBe('rejected');
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('throws the identical "AgentAction not found" error (not a distinct message) when the action exists but belongs to a different tenant, and leaves its status unchanged', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry(undefined, testAuditLog);
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    // Action is genuinely created and persisted under tenant-1.
    const pending = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    // Spy only after the setup run() above, so this spy captures exactly
    // what reject itself does, not the write run() made.
    const updateSpy = vi.spyOn(store, 'update');

    // A different tenant (tenant-2) attempts to reject tenant-1's action.
    await expect(
      runner.reject(pending.action!.id, 'tenant-2')
    ).rejects.toThrow(`AgentAction not found: ${pending.action!.id}`);

    expect(updateSpy).not.toHaveBeenCalled();
    const stored = await store.get(pending.action!.id);
    expect(stored?.status).toBe('pending_confirm');
  });
});
