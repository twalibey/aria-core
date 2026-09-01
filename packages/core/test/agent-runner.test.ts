import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '../src/agent-runner';
import { InMemoryAgentActionStore } from '../src/agent-action-store-in-memory';
import { ToolRegistry } from '../src/tools';
import type { AgentAction, AgentActionStore, AgentDefinition, AgentDraftOutput } from '../src/agent-types';
import type { LLMProvider } from '../src/types';

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
    const registry = new ToolRegistry();
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
    const registry = new ToolRegistry();
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('skipped_already_claimed');
  });

  it('writes a pending_confirm action on a successful draft when autonomy is confirm', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry();
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
    const registry = new ToolRegistry();
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
    const registry = new ToolRegistry();
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('draft_failed');
  });

  it('escalates to needs_attention once attemptCount reaches maxAttempts', async () => {
    const llm = makeLLM(new Error('LLM timeout'));
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry();
    const runner = new AgentRunner(llm, registry, store, undefined, 3);
    const definition = makeDefinition();

    // Simulate the cron job's own re-claim-by-id retry: directly bump
    // attemptCount to 2 on the store before the 3rd run, matching what a
    // real retry loop looks like from the store's perspective. AgentRunner
    // itself only ever increments by 1 per call.
    const claimed = await store.claim({
      tenantId: 'tenant-1',
      agentId: 'test-agent',
      sourceType: 'test_source',
      sourceId: 'sub-1',
    });
    await store.update(claimed!.id, { attemptCount: 2 });

    const result = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');

    expect(result.status).toBe('needs_attention');
    expect(result.action?.attemptCount).toBe(3);
  });

  it('does not reprocess a row already at needs_attention status: no further LLM call, no infinite retry', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry();
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
    const registry = new ToolRegistry();
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
    const registry = new ToolRegistry();
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
    const registry = new ToolRegistry();
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

  it('writes send_failed when autonomy is auto and the tool execution fails', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry();
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
