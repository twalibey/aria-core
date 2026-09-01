# CorpFlow Autonomous Agents (Framework + Donor Response Agent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, tenant-aware autonomous-agent mechanism (`AgentRunner`) in `@aria/core`, and prove it end-to-end with one real agent — CorpFlow's Donor Response Agent, which drafts a personalized follow-up after a donation-form submission, gated behind a per-tenant `off`/`confirm`/`auto` autonomy setting, fully audited.

**Architecture:** `AgentRunner` is a new, standalone unit in `@aria/core` — deliberately not built on `ChatEngine` (no conversation history/memory/guardrails/sentiment apply to a one-shot draft-then-gate task). It reuses only `LLMProvider` and `ToolRegistry` (for tenant-scoped execution of the agent's gated action). `@aria/adapter-corpflow` gets one new, schema-agnostic factory (`createDrizzleAgentActionStore`), mirroring the existing `createDrizzleQueryPlanRunner` pattern exactly — generic mechanism only, zero CorpFlow schema knowledge. All CorpFlow-specific content (the real `AgentDefinition`, the DB schema, the cron job, the Slack alerts, the staff UI) lives in the CorpFlow repo itself, mirroring where `nl-query`'s real whitelist/prompt already live (not in `@aria/adapter-corpflow`) — a deliberate correction from the spec's slightly looser wording on this one boundary, made here because it's the exact same precedent this same pillar already established once.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM, tsup (dual ESM/CJS build), Next.js API routes (CorpFlow), Vercel Cron, Resend (email), Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-08-31-aria-corpflow-autonomous-agents-design.md`

## Global Constraints

- `@aria/core` stays provider-agnostic and ORM-agnostic — no Anthropic/OpenRouter-specific logic, no Drizzle imports, anywhere in `packages/core/src/`.
- `@aria/adapter-corpflow` stays schema-agnostic — no import of CorpFlow's real `schema.ts`, only generic, structurally-typed factories (mirrors `query-plan-runner.ts`'s `DrizzleQueryable` pattern exactly).
- Every new adapter-corpflow test that touches Drizzle must use real `drizzle-orm` operator functions (`eq`, `and`, etc.) against a fake `vi.fn()`-based db chain — never a hand-rolled fake condition object — matching `query-plan-runner.test.ts`'s established convention.
- Full workspace test suite (`npm test`) and full workspace typecheck (`npm run typecheck`, which runs `tsc -b --noEmit` plus `vitest --typecheck.only`) must pass before any task is considered done — this project has been bitten twice by fixes that pass one package's tests but break the workspace-wide typecheck.
- **Correction made during pre-flight (2026-08-31), replacing an earlier draft of this constraint:** unlike the standalone `MemoryManager` fence fix (which had no real consumer and could defer its tag indefinitely), CorpFlow's own Tasks 9-15 in Part 3 are the direct, real consumer of the new `@aria/core`/`@aria/adapter-corpflow` code — without a new tag, those tasks cannot resolve `AgentRunner`, `createDrizzleAgentActionStore`, or the new agent types at all. A version bump and tag ARE required partway through this plan, at Task 7.5 (between Parts 2 and 3), mirroring exactly how the tenant-scoping pillar cut `v0.1.0`→`v0.2.0`→`v0.3.0` mid-plan for the same reason. Creating and pushing a git tag is a real, external, shared-state action — Task 7.5 stops and asks the user before doing it, same as the tenant-scoping precedent's own Task 9.
- Donor Response Agent processes every donation submission — no dollar threshold (per-project decision, 2026-08-31).
- The agent's follow-up email is treated as transactional (tied to the specific gift just made) — no separate consent/opt-out mechanism in this plan. RISK-005 is filed for this in Task 15.
- `agent_actions`'s `(source_type, source_id, agent_id)` triple is UNIQUE — this is the atomic claim mechanism. No task may bypass it with a separate lock or flag.
- Retry cap is 3 attempts (`attemptCount >= 3` → terminal `needs_attention`, not infinite retry).

---

## Part 1 — `@aria/core` primitives

### Task 1: Extract `stripMarkdownFence` into a shared utility

**Files:**
- Create: `packages/core/src/fence-parser.ts`
- Create: `packages/core/test/fence-parser.test.ts`
- Modify: `packages/core/src/memory-manager.ts` (remove the private copy, import the shared one)

**Interfaces:**
- Produces: `stripMarkdownFence(text: string): string` — exported from `fence-parser.ts`, used by Task 3's `AgentRunner` and by the now-updated `memory-manager.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/fence-parser.test.ts
import { describe, it, expect } from 'vitest';
import { stripMarkdownFence } from '../src/fence-parser';

describe('stripMarkdownFence', () => {
  it('strips a fence that spans the whole trimmed string', () => {
    const input = '```json\n{"a":1}\n```';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });

  it('strips a fence with trailing prose after the closing fence', () => {
    const input = '```json\n{"a":1}\n```\n\n**Note:** I omitted extra fields.';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });

  it('strips a fence with leading prose before the opening fence', () => {
    const input = 'Here is the JSON:\n```json\n{"a":1}\n```';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });

  it('returns the trimmed text unchanged when no fence is present', () => {
    const input = '  {"a":1}  ';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/fence-parser.test.ts`
Expected: FAIL — `Failed to resolve import "../src/fence-parser"`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/fence-parser.ts

// Unanchored on purpose: live models sometimes wrap JSON in a fence and then
// append (or prepend) trailing prose outside it despite being told not to.
// Searching for the fence anywhere in the string — rather than requiring it
// to span the entire trimmed text — lets us still extract the JSON in that
// case instead of failing to match at all and passing the raw text (prose
// included) to JSON.parse. Shared by MemoryManager and AgentRunner — both
// parse LLM output that is supposed to be JSON but sometimes isn't cleanly.
const MARKDOWN_FENCE_RE = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;

export function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(MARKDOWN_FENCE_RE);
  return match ? match[1].trim() : trimmed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/fence-parser.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Update `memory-manager.ts` to use the shared utility**

In `packages/core/src/memory-manager.ts`, remove the local `MARKDOWN_FENCE_RE` constant and the local `stripMarkdownFence` function (currently near the top of the file), and add:

```typescript
import { stripMarkdownFence } from './fence-parser.js';
```

Leave every call site of `stripMarkdownFence(...)` inside `memory-manager.ts` unchanged — only the definition moves.

- [ ] **Step 6: Run the full core test suite to confirm nothing broke**

Run: `cd packages/core && npx vitest run`
Expected: all existing tests still pass, including every `memory-manager.test.ts` case (trailing-prose, leading-prose, and the original no-surrounding-prose fence cases added in the earlier `MemoryManager` fix)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/fence-parser.ts packages/core/test/fence-parser.test.ts packages/core/src/memory-manager.ts
git commit -m "refactor(core): extract stripMarkdownFence into a shared fence-parser utility"
```

---

### Task 2: Agent types and `InMemoryAgentActionStore`

**Files:**
- Create: `packages/core/src/agent-types.ts`
- Create: `packages/core/src/agent-action-store-in-memory.ts`
- Create: `packages/core/test/agent-action-store-in-memory.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition` from `./types.js` (existing: `{ name: string; description: string; parameters: object; mutatesContext?: boolean }`)
- Produces (used by Tasks 3–7):
  - `type AutonomyLevel = 'off' | 'confirm' | 'auto'`
  - `type AgentActionStatus = 'processing' | 'pending_confirm' | 'auto_sent' | 'draft_failed' | 'needs_attention' | 'sent' | 'edited_and_sent' | 'rejected' | 'send_failed'`
  - `interface AgentAction { id: string; tenantId: string; agentId: string; sourceType: string; sourceId: string; status: AgentActionStatus; draftContent: string | null; sourceSnapshot: Record<string, unknown> | null; attemptCount: number; confirmedByUserId: string | null; createdAt: Date; updatedAt: Date }`
  - `interface AgentDraftOutput { draftContent: string; sourceSnapshot: Record<string, unknown> }`
  - `interface AgentActionStore { claim(params: { tenantId: string; agentId: string; sourceType: string; sourceId: string }): Promise<AgentAction | null>; update(id: string, patch: Partial<Pick<AgentAction, 'status' | 'draftContent' | 'sourceSnapshot' | 'attemptCount' | 'confirmedByUserId'>>): Promise<AgentAction>; get(id: string): Promise<AgentAction | null> }`
  - `interface AgentDefinition<Input> { id: string; sourceType: string; buildPrompt(input: Input): { systemPrompt: string; userPrompt: string }; parseOutput(raw: string): AgentDraftOutput; action: ToolDefinition; buildToolArgs(draft: AgentDraftOutput): Record<string, unknown>; checkAutonomy(tenantId: string): Promise<AutonomyLevel> }`
  - `type AgentErrorHook = (params: { agentId: string; tenantId: string; error: Error }) => void`
  - `interface AgentRunResult { status: AgentActionStatus | 'skipped_off' | 'skipped_already_claimed'; action?: AgentAction }`
  - `class InMemoryAgentActionStore implements AgentActionStore`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/agent-action-store-in-memory.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryAgentActionStore } from '../src/agent-action-store-in-memory';

describe('InMemoryAgentActionStore', () => {
  it('claim creates a new processing row on first call', async () => {
    const store = new InMemoryAgentActionStore();
    const action = await store.claim({
      tenantId: 'tenant-1',
      agentId: 'donor-response',
      sourceType: 'donation_form_submission',
      sourceId: 'sub-1',
    });
    expect(action).not.toBeNull();
    expect(action!.status).toBe('processing');
    expect(action!.attemptCount).toBe(0);
    expect(action!.tenantId).toBe('tenant-1');
  });

  it('claim returns null on a second attempt for the same (sourceType, sourceId, agentId)', async () => {
    const store = new InMemoryAgentActionStore();
    const params = {
      tenantId: 'tenant-1',
      agentId: 'donor-response',
      sourceType: 'donation_form_submission',
      sourceId: 'sub-1',
    };
    const first = await store.claim(params);
    const second = await store.claim(params);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('claim allows the same sourceId under a different agentId', async () => {
    const store = new InMemoryAgentActionStore();
    const a = await store.claim({ tenantId: 't1', agentId: 'agent-a', sourceType: 'x', sourceId: 'same' });
    const b = await store.claim({ tenantId: 't1', agentId: 'agent-b', sourceType: 'x', sourceId: 'same' });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it('update patches fields and returns the updated row', async () => {
    const store = new InMemoryAgentActionStore();
    const created = await store.claim({ tenantId: 't1', agentId: 'a', sourceType: 'x', sourceId: 's1' });
    const updated = await store.update(created!.id, { status: 'pending_confirm', draftContent: 'hello' });
    expect(updated.status).toBe('pending_confirm');
    expect(updated.draftContent).toBe('hello');
    expect(updated.id).toBe(created!.id);
  });

  it('update throws for an unknown id', async () => {
    const store = new InMemoryAgentActionStore();
    await expect(store.update('does-not-exist', { status: 'sent' })).rejects.toThrow();
  });

  it('get returns null for an unknown id', async () => {
    const store = new InMemoryAgentActionStore();
    expect(await store.get('does-not-exist')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/agent-action-store-in-memory.test.ts`
Expected: FAIL — cannot resolve `../src/agent-action-store-in-memory`

- [ ] **Step 3: Write the types**

```typescript
// packages/core/src/agent-types.ts
import type { ToolDefinition } from './types.js';

export type AutonomyLevel = 'off' | 'confirm' | 'auto';

export type AgentActionStatus =
  | 'processing'
  | 'pending_confirm'
  | 'auto_sent'
  | 'draft_failed'
  | 'needs_attention'
  | 'sent'
  | 'edited_and_sent'
  | 'rejected'
  | 'send_failed';

export interface AgentAction {
  id: string;
  tenantId: string;
  agentId: string;
  sourceType: string;
  sourceId: string;
  status: AgentActionStatus;
  draftContent: string | null;
  sourceSnapshot: Record<string, unknown> | null;
  attemptCount: number;
  confirmedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentDraftOutput {
  draftContent: string;
  sourceSnapshot: Record<string, unknown>;
}

export interface AgentActionStore {
  claim(params: {
    tenantId: string;
    agentId: string;
    sourceType: string;
    sourceId: string;
  }): Promise<AgentAction | null>;
  update(
    id: string,
    patch: Partial<
      Pick<AgentAction, 'status' | 'draftContent' | 'sourceSnapshot' | 'attemptCount' | 'confirmedByUserId'>
    >
  ): Promise<AgentAction>;
  get(id: string): Promise<AgentAction | null>;
}

export interface AgentDefinition<Input> {
  id: string;
  sourceType: string;
  buildPrompt(input: Input): { systemPrompt: string; userPrompt: string };
  parseOutput(raw: string): AgentDraftOutput;
  action: ToolDefinition;
  buildToolArgs(draft: AgentDraftOutput): Record<string, unknown>;
  checkAutonomy(tenantId: string): Promise<AutonomyLevel>;
}

export type AgentErrorHook = (params: { agentId: string; tenantId: string; error: Error }) => void;

export interface AgentRunResult {
  status: AgentActionStatus | 'skipped_off' | 'skipped_already_claimed';
  action?: AgentAction;
}
```

- [ ] **Step 4: Write the in-memory store**

```typescript
// packages/core/src/agent-action-store-in-memory.ts
import { randomUUID } from 'node:crypto';
import type { AgentAction, AgentActionStore } from './agent-types.js';

// Reference implementation and test fixture — mirrors InMemoryHistoryStore's
// role: not meant for production use (no persistence across process
// restarts), but a real, exported implementation adapters can use directly
// in their own tests instead of hand-rolling a fake.
export class InMemoryAgentActionStore implements AgentActionStore {
  private actions = new Map<string, AgentAction>();
  private claimIndex = new Set<string>(); // key: `${sourceType}:${sourceId}:${agentId}`

  async claim(params: {
    tenantId: string;
    agentId: string;
    sourceType: string;
    sourceId: string;
  }): Promise<AgentAction | null> {
    const key = `${params.sourceType}:${params.sourceId}:${params.agentId}`;
    if (this.claimIndex.has(key)) return null;
    this.claimIndex.add(key);

    const now = new Date();
    const action: AgentAction = {
      id: randomUUID(),
      tenantId: params.tenantId,
      agentId: params.agentId,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      status: 'processing',
      draftContent: null,
      sourceSnapshot: null,
      attemptCount: 0,
      confirmedByUserId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.actions.set(action.id, action);
    return action;
  }

  async update(
    id: string,
    patch: Partial<
      Pick<AgentAction, 'status' | 'draftContent' | 'sourceSnapshot' | 'attemptCount' | 'confirmedByUserId'>
    >
  ): Promise<AgentAction> {
    const existing = this.actions.get(id);
    if (!existing) throw new Error(`AgentAction not found: ${id}`);
    const updated: AgentAction = { ...existing, ...patch, updatedAt: new Date() };
    this.actions.set(id, updated);
    return updated;
  }

  async get(id: string): Promise<AgentAction | null> {
    return this.actions.get(id) ?? null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/agent-action-store-in-memory.test.ts`
Expected: PASS (6/6)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent-types.ts packages/core/src/agent-action-store-in-memory.ts packages/core/test/agent-action-store-in-memory.test.ts
git commit -m "feat(core): add agent framework types and InMemoryAgentActionStore"
```

---

### Task 3: `AgentRunner.run()` — off/claim/draft-failure/confirm-gate paths

**Files:**
- Create: `packages/core/src/agent-runner.ts`
- Create: `packages/core/test/agent-runner.test.ts`

**Interfaces:**
- Consumes: `LLMProvider.call({ systemPrompt, messages }): Promise<LLMResponse>` (existing, `LLMResponse = { content: string; toolCalls?: LLMToolCall[] }`, `LLMMessage = { role: 'user'|'assistant'; content: string }`), `ToolRegistry` (existing, from Task 4 on), `AgentActionStore`/`AgentDefinition`/`AgentDraftOutput`/`AgentErrorHook`/`AgentRunResult` (Task 2), `stripMarkdownFence` (Task 1, used inside test fixtures/agent definitions, not by `AgentRunner` itself — `AgentRunner` calls `definition.parseOutput`, which is where a real `AgentDefinition` would use `stripMarkdownFence`).
- Produces (used by Task 4, Task 5, and CorpFlow's cron job): `class AgentRunner { constructor(llmProvider: LLMProvider, toolRegistry: ToolRegistry, actionStore: AgentActionStore, onError?: AgentErrorHook, maxAttempts?: number); run<Input>(definition: AgentDefinition<Input>, input: Input, tenantId: string, sourceId: string): Promise<AgentRunResult> }`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/test/agent-runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '../src/agent-runner';
import { InMemoryAgentActionStore } from '../src/agent-action-store-in-memory';
import { ToolRegistry } from '../src/tools';
import type { AgentDefinition, AgentDraftOutput } from '../src/agent-types';
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/agent-runner.test.ts`
Expected: FAIL — cannot resolve `../src/agent-runner`

- [ ] **Step 3: Write the implementation (off/claim/draft-failure/confirm-gate paths only — auto-execute path is Task 4)**

```typescript
// packages/core/src/agent-runner.ts
import type { LLMProvider } from './types.js';
import type { ToolRegistry } from './tools.js';
import type {
  AgentActionStore,
  AgentAction,
  AgentActionStatus,
  AgentDefinition,
  AgentErrorHook,
  AgentRunResult,
} from './agent-types.js';

export class AgentRunner {
  constructor(
    private llmProvider: LLMProvider,
    private toolRegistry: ToolRegistry,
    private actionStore: AgentActionStore,
    private onError?: AgentErrorHook,
    private maxAttempts: number = 3
  ) {}

  async run<Input>(
    definition: AgentDefinition<Input>,
    input: Input,
    tenantId: string,
    sourceId: string
  ): Promise<AgentRunResult> {
    const autonomy = await definition.checkAutonomy(tenantId);
    if (autonomy === 'off') {
      return { status: 'skipped_off' };
    }

    const claimed = await this.actionStore.claim({
      tenantId,
      agentId: definition.id,
      sourceType: definition.sourceType,
      sourceId,
    });
    if (!claimed) {
      return { status: 'skipped_already_claimed' };
    }

    let draft;
    try {
      const { systemPrompt, userPrompt } = definition.buildPrompt(input);
      const response = await this.llmProvider.call({
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      draft = definition.parseOutput(response.content);
    } catch (err) {
      return this.handleDraftFailure(definition, tenantId, claimed, err);
    }

    if (autonomy === 'confirm') {
      const updated = await this.actionStore.update(claimed.id, {
        status: 'pending_confirm',
        draftContent: draft.draftContent,
        sourceSnapshot: draft.sourceSnapshot,
      });
      return { status: 'pending_confirm', action: updated };
    }

    // autonomy === 'auto' — implemented in Task 4
    return this.runAutoExecute(definition, tenantId, claimed, draft);
  }

  private async handleDraftFailure<Input>(
    definition: AgentDefinition<Input>,
    tenantId: string,
    claimed: AgentAction,
    err: unknown
  ): Promise<AgentRunResult> {
    const attemptCount = claimed.attemptCount + 1;
    const status: AgentActionStatus = attemptCount >= this.maxAttempts ? 'needs_attention' : 'draft_failed';
    const updated = await this.actionStore.update(claimed.id, { status, attemptCount });
    this.onError?.({
      agentId: definition.id,
      tenantId,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return { status, action: updated };
  }

  // Placeholder for Task 4 — overridden in that task's diff, not left
  // unimplemented in this codebase once Task 4 lands.
  private async runAutoExecute<Input>(
    _definition: AgentDefinition<Input>,
    _tenantId: string,
    claimed: AgentAction,
    draft: { draftContent: string; sourceSnapshot: Record<string, unknown> }
  ): Promise<AgentRunResult> {
    const updated = await this.actionStore.update(claimed.id, {
      status: 'pending_confirm',
      draftContent: draft.draftContent,
      sourceSnapshot: draft.sourceSnapshot,
    });
    return { status: 'pending_confirm', action: updated };
  }
}
```

**Note for the implementer:** the `runAutoExecute` body above is intentionally a temporary stand-in (it degrades `'auto'` to the same behavior as `'confirm'`) so this task's own tests — none of which exercise `autonomy === 'auto'` — pass without depending on Task 4. Task 4 replaces this entire method body with the real `ToolRegistry.execute()` call. Do not leave the two behaviors identical after Task 4 lands; Task 4's own tests assert they differ.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/agent-runner.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-runner.ts packages/core/test/agent-runner.test.ts
git commit -m "feat(core): add AgentRunner off/claim/draft-failure/confirm-gate paths"
```

---

### Task 4: `AgentRunner.run()` — auto-execute path

**Files:**
- Modify: `packages/core/src/agent-runner.ts` (replace `runAutoExecute`'s temporary body from Task 3)
- Modify: `packages/core/test/agent-runner.test.ts` (add auto-path tests)

**Interfaces:**
- Consumes: `ToolRegistry.execute(userId, toolName, args, tenant?): Promise<ToolExecutionResult>` (existing, `ToolExecutionResult = { success: boolean; result?: string; error?: string }`), `definition.action.name`, `definition.buildToolArgs(draft)` (Task 2).
- Produces: the real `'auto'` behavior other tasks (Task 5, CorpFlow's cron job) depend on — `'auto'` now actually executes the tool and can produce `'auto_sent'` or `'send_failed'`, distinct from `'confirm'`'s `'pending_confirm'`.

- [ ] **Step 1: Write the failing tests (append to `agent-runner.test.ts`)**

```typescript
// Add to packages/core/test/agent-runner.test.ts, inside the existing describe block

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/agent-runner.test.ts`
Expected: FAIL — the two new tests fail because `runAutoExecute` still degrades to `'pending_confirm'` (Task 3's temporary body)

- [ ] **Step 3: Replace `runAutoExecute` with the real implementation**

In `packages/core/src/agent-runner.ts`, replace the entire `runAutoExecute` method (the Task 3 placeholder) with:

```typescript
  private async runAutoExecute<Input>(
    definition: AgentDefinition<Input>,
    tenantId: string,
    claimed: AgentAction,
    draft: { draftContent: string; sourceSnapshot: Record<string, unknown> }
  ): Promise<AgentRunResult> {
    const toolArgs = definition.buildToolArgs(draft);
    const result = await this.toolRegistry.execute(
      `agent:${definition.id}`,
      definition.action.name,
      toolArgs,
      { tenantId }
    );

    if (!result.success) {
      const updated = await this.actionStore.update(claimed.id, {
        status: 'send_failed',
        draftContent: draft.draftContent,
        sourceSnapshot: draft.sourceSnapshot,
      });
      this.onError?.({
        agentId: definition.id,
        tenantId,
        error: new Error(result.error ?? `Tool execution failed for ${definition.action.name}`),
      });
      return { status: 'send_failed', action: updated };
    }

    const updated = await this.actionStore.update(claimed.id, {
      status: 'auto_sent',
      draftContent: draft.draftContent,
      sourceSnapshot: draft.sourceSnapshot,
    });
    return { status: 'auto_sent', action: updated };
  }
```

Also update the call site inside `run()` — the line `return this.runAutoExecute(definition, tenantId, claimed, draft);` — no change needed there, it already passes the right arguments.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/agent-runner.test.ts`
Expected: PASS (9/9 — all of Task 3's tests plus the two new ones)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-runner.ts packages/core/test/agent-runner.test.ts
git commit -m "feat(core): implement AgentRunner's auto-execute path via ToolRegistry"
```

---

### Task 5: `AgentRunner.confirmAndExecute()` and `AgentRunner.reject()`

**Files:**
- Modify: `packages/core/src/agent-runner.ts`
- Modify: `packages/core/test/agent-runner.test.ts`

**Interfaces:**
- Produces (used by CorpFlow's approve/reject API endpoints, Task 12): `confirmAndExecute(definition: AgentDefinition<unknown>, actionId: string, tenantId: string, userId: string, opts?: { editedContent?: string }): Promise<AgentAction>`, `reject(actionId: string, tenantId: string): Promise<AgentAction>`.

- [ ] **Step 1: Write the failing tests (append to `agent-runner.test.ts`)**

```typescript
describe('AgentRunner.confirmAndExecute', () => {
  it('executes the tool with the original draft content and marks the action sent', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry();
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
    const registry = new ToolRegistry();
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
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    const pending = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');
    const result = await runner.confirmAndExecute(definition, pending.action!.id, 'tenant-1', 'staff-user-1');

    expect(result.status).toBe('send_failed');
  });

  it('throws if the actionId does not exist', async () => {
    const llm = makeLLM('{}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry();
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    await expect(
      runner.confirmAndExecute(definition, 'does-not-exist', 'tenant-1', 'staff-user-1')
    ).rejects.toThrow();
  });
});

describe('AgentRunner.reject', () => {
  it('marks the action rejected without executing the tool', async () => {
    const llm = makeLLM('{"draftContent":"Thanks Ada!","sourceSnapshot":{"amount":10}}');
    const store = new InMemoryAgentActionStore();
    const registry = new ToolRegistry();
    const executeSpy = vi.spyOn(registry, 'execute');
    const runner = new AgentRunner(llm, registry, store);
    const definition = makeDefinition();

    const pending = await runner.run(definition, { donorName: 'Ada', amount: 10 }, 'tenant-1', 'sub-1');
    const rejected = await runner.reject(pending.action!.id, 'tenant-1');

    expect(rejected.status).toBe('rejected');
    expect(executeSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/agent-runner.test.ts`
Expected: FAIL — `runner.confirmAndExecute is not a function`, `runner.reject is not a function`

- [ ] **Step 3: Add the two methods to `AgentRunner`**

In `packages/core/src/agent-runner.ts`, add these two public methods (e.g. after `run`):

```typescript
  async confirmAndExecute(
    definition: AgentDefinition<unknown>,
    actionId: string,
    tenantId: string,
    userId: string,
    opts?: { editedContent?: string }
  ): Promise<AgentAction> {
    const existing = await this.actionStore.get(actionId);
    if (!existing) throw new Error(`AgentAction not found: ${actionId}`);

    const content = opts?.editedContent ?? existing.draftContent ?? '';
    const draft = { draftContent: content, sourceSnapshot: existing.sourceSnapshot ?? {} };
    const toolArgs = definition.buildToolArgs(draft);

    const result = await this.toolRegistry.execute(userId, definition.action.name, toolArgs, { tenantId });

    if (!result.success) {
      this.onError?.({
        agentId: definition.id,
        tenantId,
        error: new Error(result.error ?? `Tool execution failed for ${definition.action.name}`),
      });
      return this.actionStore.update(actionId, { status: 'send_failed' });
    }

    const finalStatus: AgentActionStatus = opts?.editedContent ? 'edited_and_sent' : 'sent';
    return this.actionStore.update(actionId, {
      status: finalStatus,
      draftContent: content,
      confirmedByUserId: userId,
    });
  }

  async reject(actionId: string, tenantId: string): Promise<AgentAction> {
    const existing = await this.actionStore.get(actionId);
    if (!existing) throw new Error(`AgentAction not found: ${actionId}`);
    return this.actionStore.update(actionId, { status: 'rejected' });
  }
```

(`tenantId` in `reject` is accepted for symmetry and future tenant-ownership verification — matches this codebase's established pattern of taking `tenantId` even when a given method body doesn't yet branch on it, e.g. `SecurityAuditLog.logViolation`'s optional `tenantId` field.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/agent-runner.test.ts`
Expected: PASS (14/14)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-runner.ts packages/core/test/agent-runner.test.ts
git commit -m "feat(core): add AgentRunner.confirmAndExecute and reject"
```

---

### Task 6: Export the agent framework from `@aria/core`'s public API, update README

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/README.md`

**Interfaces:**
- Produces: the public surface `@aria/adapter-corpflow` (Task 7) and CorpFlow (Tasks 9–13) import from `@aria/core`.

- [ ] **Step 1: Add the new exports**

In `packages/core/src/index.ts`, add (after the existing `QuerySpecExecutor` export lines):

```typescript
export { AgentRunner } from './agent-runner.js';
export { InMemoryAgentActionStore } from './agent-action-store-in-memory.js';
export { stripMarkdownFence } from './fence-parser.js';
export type {
  AutonomyLevel,
  AgentActionStatus,
  AgentAction,
  AgentDraftOutput,
  AgentActionStore,
  AgentDefinition,
  AgentErrorHook,
  AgentRunResult,
} from './agent-types.js';
```

- [ ] **Step 2: Add a README section**

In `packages/core/README.md`, add a new section (matching the existing structure/tone of the README's other mechanism sections — read the file first to match its heading level and style) documenting: what `AgentRunner` is for, the three autonomy levels and their meaning (`off` = no LLM call at all; `confirm` = draft only, held for human approval; `auto` = drafts and executes immediately), that the claim mechanism relies on the adapter-supplied `AgentActionStore`'s `claim()` being atomic at the storage layer (a unique constraint on `(sourceType, sourceId, agentId)` for a real DB-backed store), and the retry/`needs_attention` escalation behavior.

- [ ] **Step 3: Build and typecheck the whole workspace**

Run: `cd "/Users/mrdrdaddy/Desktop/Warp Projects/ARIA" && npm run build -w @aria/core && npm run typecheck`
Expected: build succeeds, typecheck clean (0 errors)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts packages/core/README.md
git commit -m "feat(core): export agent framework from public API, document in README"
```

---

## Part 2 — `@aria/adapter-corpflow`

**Pre-flight note (caught before dispatch, 2026-08-31):** `packages/adapter-corpflow/package.json` pins `@aria/core` via a git-tag URL (`github:twalibey/aria-core#core-v0.3.0`), not a workspace link — unlike `adapter-example`/`adapter-fitness`, which both use `"@aria/core": "*"` and pick up local workspace changes automatically. This is a known, previously-bitten gotcha in this exact project (the tenant-scoping pillar's final review found its own "end-to-end" test was unknowingly running against a stale published tag for the same reason). Left as-is, Task 7 would test against `v0.3.0` — which has none of Tasks 1-6's new code — not local changes. Task 7's Step 0 below fixes this for local development; it is not part of any future external-tag/publish step and must not be treated as one.

### Task 7: `createDrizzleAgentActionStore` factory

**Files:**
- Create: `packages/adapter-corpflow/src/agent-action-store.ts`
- Create: `packages/adapter-corpflow/test/agent-action-store.test.ts`
- Modify: `packages/adapter-corpflow/src/index.ts`

**Interfaces:**
- Consumes: `AgentActionStore`, `AgentAction`, `AgentActionStatus` types from `@aria/core` (Task 2/6).
- Produces (consumed by CorpFlow's Task 9): `createDrizzleAgentActionStore(db: DrizzleAgentActionQueryable, table: AgentActionsTableRef): AgentActionStore`, and the `DrizzleAgentActionQueryable`/`AgentActionsTableRef` types themselves (exported so CorpFlow's call site can type its real `db`/table correctly).

**Design note (mirrors `query-plan-runner.ts`'s established pattern exactly):** this factory takes a minimal structural interface for the Drizzle chains it actually calls (`insert`/`update`/`select`), and a generic `table` reference object with named column refs — it never imports CorpFlow's real `schema.ts`. CorpFlow supplies its real `db` and real `agentActions` table object (from Task 8's migration) when it calls this factory (Task 9).

- [ ] **Step 0: Fix `@aria/core` resolution for local development**

In `packages/adapter-corpflow/package.json`, change both occurrences of `"@aria/core": "github:twalibey/aria-core#core-v0.3.0"` (in `dependencies` and `peerDependencies`, or wherever both appear — check the file) to `"@aria/core": "*"`, matching `adapter-example`/`adapter-fitness`'s existing local-dev convention exactly. Then, from the workspace root:

```bash
cd "/Users/mrdrdaddy/Desktop/Warp Projects/ARIA"
rm -rf node_modules package-lock.json packages/adapter-corpflow/node_modules
npm install
```

Run: `npm ls @aria/core` and confirm `packages/adapter-corpflow` now resolves `@aria/core` to the local workspace `packages/core` (a `link:` or workspace-relative resolution in the output), not a git URL.

**This package.json change is temporary, for this plan's local development only — do not commit it as a permanent fix.** It must be reverted back to the real git-tag pin before any future step that cuts a new `@aria/core`/`@aria/adapter-corpflow` tag for CorpFlow to actually consume externally (out of scope for this plan per the Global Constraints — no task here bumps version or retags). Leave a note in this task's commit message flagging the revert as a follow-up, and do not let a later task in this plan quietly re-commit the git-tag version without reverting it back to workspace-linked first.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/adapter-corpflow/test/agent-action-store.test.ts
import { describe, it, expect, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createDrizzleAgentActionStore } from '../src/agent-action-store';

function makeTableRef() {
  return {
    id: { name: 'id' } as any,
    tenantId: { name: 'tenant_id' } as any,
    agentId: { name: 'agent_id' } as any,
    sourceType: { name: 'source_type' } as any,
    sourceId: { name: 'source_id' } as any,
    status: { name: 'status' } as any,
    draftContent: { name: 'draft_content' } as any,
    sourceSnapshot: { name: 'source_snapshot' } as any,
    attemptCount: { name: 'attempt_count' } as any,
    confirmedByUserId: { name: 'confirmed_by_user_id' } as any,
    createdAt: { name: 'created_at' } as any,
    updatedAt: { name: 'updated_at' } as any,
  };
}

function makeDb(opts: { insertReturns?: Record<string, unknown>[]; updateReturns?: Record<string, unknown>[]; selectReturns?: Record<string, unknown>[] } = {}) {
  const insertReturning = vi.fn().mockResolvedValue(opts.insertReturns ?? []);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturning = vi.fn().mockResolvedValue(opts.updateReturns ?? []);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  const selectLimit = vi.fn().mockResolvedValue(opts.selectReturns ?? []);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const db = { insert, update, select };
  return { db, insert, insertValues, onConflictDoNothing, insertReturning, update, updateSet, updateWhere, updateReturning, select, selectFrom, selectWhere, selectLimit };
}

const NOW_ROW = {
  id: 'action-1',
  tenant_id: 'tenant-1',
  agent_id: 'donor-response',
  source_type: 'donation_form_submission',
  source_id: 'sub-1',
  status: 'processing',
  draft_content: null,
  source_snapshot: null,
  attempt_count: 0,
  confirmed_by_user_id: null,
  created_at: new Date('2026-08-31T00:00:00Z'),
  updated_at: new Date('2026-08-31T00:00:00Z'),
};

describe('createDrizzleAgentActionStore', () => {
  describe('claim', () => {
    it('inserts a new processing row and maps snake_case columns to the AgentAction shape', async () => {
      const { db, insertValues, onConflictDoNothing } = makeDb({ insertReturns: [NOW_ROW] });
      const table = makeTableRef();
      const store = createDrizzleAgentActionStore(db as any, table);

      const action = await store.claim({
        tenantId: 'tenant-1',
        agentId: 'donor-response',
        sourceType: 'donation_form_submission',
        sourceId: 'sub-1',
      });

      expect(action).not.toBeNull();
      expect(action!.id).toBe('action-1');
      expect(action!.status).toBe('processing');
      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ tenant_id: 'tenant-1', agent_id: 'donor-response', status: 'processing' })
      );
      expect(onConflictDoNothing).toHaveBeenCalledWith({ target: [table.sourceType, table.sourceId, table.agentId] });
    });

    it('returns null when the insert conflicts (row already claimed)', async () => {
      const { db } = makeDb({ insertReturns: [] });
      const table = makeTableRef();
      const store = createDrizzleAgentActionStore(db as any, table);

      const action = await store.claim({
        tenantId: 'tenant-1',
        agentId: 'donor-response',
        sourceType: 'donation_form_submission',
        sourceId: 'sub-1',
      });

      expect(action).toBeNull();
    });
  });

  describe('update', () => {
    it('sets the given fields, uses the real eq() operator on id, and returns the mapped row', async () => {
      const updatedRow = { ...NOW_ROW, status: 'pending_confirm', draft_content: 'hello' };
      const { db, updateSet, updateWhere } = makeDb({ updateReturns: [updatedRow] });
      const table = makeTableRef();
      const store = createDrizzleAgentActionStore(db as any, table);

      const result = await store.update('action-1', { status: 'pending_confirm', draftContent: 'hello' });

      expect(result.status).toBe('pending_confirm');
      expect(result.draftContent).toBe('hello');
      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending_confirm', draft_content: 'hello' })
      );
      expect(updateWhere).toHaveBeenCalledWith(eq(table.id, 'action-1'));
    });

    it('throws when the update matches no row', async () => {
      const { db } = makeDb({ updateReturns: [] });
      const table = makeTableRef();
      const store = createDrizzleAgentActionStore(db as any, table);

      await expect(store.update('does-not-exist', { status: 'sent' })).rejects.toThrow();
    });
  });

  describe('get', () => {
    it('returns the mapped row when found', async () => {
      const { db, selectWhere } = makeDb({ selectReturns: [NOW_ROW] });
      const table = makeTableRef();
      const store = createDrizzleAgentActionStore(db as any, table);

      const result = await store.get('action-1');

      expect(result?.id).toBe('action-1');
      expect(selectWhere).toHaveBeenCalledWith(eq(table.id, 'action-1'));
    });

    it('returns null when not found', async () => {
      const { db } = makeDb({ selectReturns: [] });
      const table = makeTableRef();
      const store = createDrizzleAgentActionStore(db as any, table);

      expect(await store.get('does-not-exist')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/adapter-corpflow && npx vitest run test/agent-action-store.test.ts`
Expected: FAIL — cannot resolve `../src/agent-action-store`

- [ ] **Step 3: Write the implementation**

```typescript
// packages/adapter-corpflow/src/agent-action-store.ts
import { eq, type SQL } from 'drizzle-orm';
import type { AgentAction, AgentActionStore } from '@aria/core';

// Minimal shape of what this store needs from a Drizzle db instance — avoids
// depending on a specific Drizzle driver, mirroring query-plan-runner.ts's
// DrizzleQueryable pattern. Modeled on the exact chains this store calls:
//   db.insert(table).values(v).onConflictDoNothing({target}).returning()
//   db.update(table).set(v).where(cond).returning()
//   db.select().from(table).where(cond).limit(n)
export interface DrizzleAgentActionQueryable {
  insert: (table: unknown) => {
    values: (vals: Record<string, unknown>) => {
      onConflictDoNothing: (opts: { target: unknown[] }) => {
        returning: () => Promise<Record<string, unknown>[]>;
      };
    };
  };
  update: (table: unknown) => {
    set: (vals: Record<string, unknown>) => {
      where: (condition: SQL) => {
        returning: () => Promise<Record<string, unknown>[]>;
      };
    };
  };
  select: () => {
    from: (table: unknown) => {
      where: (condition: SQL) => {
        limit: (n: number) => Promise<Record<string, unknown>[]>;
      };
    };
  };
}

// Column refs CorpFlow's real agent_actions table must supply — no CorpFlow
// schema knowledge lives in this package, only these named references.
export interface AgentActionsTableRef {
  id: unknown;
  tenantId: unknown;
  agentId: unknown;
  sourceType: unknown;
  sourceId: unknown;
  status: unknown;
  draftContent: unknown;
  sourceSnapshot: unknown;
  attemptCount: unknown;
  confirmedByUserId: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

function rowToAction(row: Record<string, unknown>): AgentAction {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    agentId: row.agent_id as string,
    sourceType: row.source_type as string,
    sourceId: row.source_id as string,
    status: row.status as AgentAction['status'],
    draftContent: (row.draft_content as string | null) ?? null,
    sourceSnapshot: (row.source_snapshot as Record<string, unknown> | null) ?? null,
    attemptCount: row.attempt_count as number,
    confirmedByUserId: (row.confirmed_by_user_id as string | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export function createDrizzleAgentActionStore(
  db: DrizzleAgentActionQueryable,
  table: AgentActionsTableRef
): AgentActionStore {
  return {
    async claim(params) {
      const rows = await db
        .insert(table)
        .values({
          tenant_id: params.tenantId,
          agent_id: params.agentId,
          source_type: params.sourceType,
          source_id: params.sourceId,
          status: 'processing',
        })
        .onConflictDoNothing({ target: [table.sourceType, table.sourceId, table.agentId] })
        .returning();

      return rows.length > 0 ? rowToAction(rows[0]) : null;
    },

    async update(id, patch) {
      const values: Record<string, unknown> = {};
      if ('status' in patch) values.status = patch.status;
      if ('draftContent' in patch) values.draft_content = patch.draftContent;
      if ('sourceSnapshot' in patch) values.source_snapshot = patch.sourceSnapshot;
      if ('attemptCount' in patch) values.attempt_count = patch.attemptCount;
      if ('confirmedByUserId' in patch) values.confirmed_by_user_id = patch.confirmedByUserId;

      const rows = await db
        .update(table)
        .set(values)
        .where(eq(table.id as any, id))
        .returning();

      if (rows.length === 0) throw new Error(`AgentAction not found: ${id}`);
      return rowToAction(rows[0]);
    },

    async get(id) {
      const rows = await db
        .select()
        .from(table)
        .where(eq(table.id as any, id))
        .limit(1);

      return rows.length > 0 ? rowToAction(rows[0]) : null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/adapter-corpflow && npx vitest run test/agent-action-store.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Export from the package's public API**

In `packages/adapter-corpflow/src/index.ts`, add:

```typescript
export { createDrizzleAgentActionStore } from './agent-action-store.js';
export type { DrizzleAgentActionQueryable, AgentActionsTableRef } from './agent-action-store.js';
```

- [ ] **Step 6: Build and typecheck the whole workspace**

Run: `cd "/Users/mrdrdaddy/Desktop/Warp Projects/ARIA" && npm run build -w @aria/adapter-corpflow && npm run typecheck`
Expected: build succeeds, typecheck clean

- [ ] **Step 7: Commit**

```bash
git add packages/adapter-corpflow/src/agent-action-store.ts packages/adapter-corpflow/test/agent-action-store.test.ts packages/adapter-corpflow/src/index.ts packages/adapter-corpflow/package.json package-lock.json
git commit -m "feat(adapter-corpflow): add createDrizzleAgentActionStore factory

Also switches adapter-corpflow's @aria/core dependency from its
git-tag pin to a workspace link (\"*\"), matching adapter-example and
adapter-fitness, so local development resolves against this branch's
own core changes instead of the stale published tag. Must be
reverted back to a git-tag pin before any future external tag/publish
of these packages - not part of this task, flagged for whoever does
that next."
```

---

### Task 7.5: Version bump, tag, and CorpFlow repin (stop-and-ask checkpoint)

**Why this task exists:** Part 3's tasks (9 onward) import `AgentRunner`, `createDrizzleAgentActionStore`, and the new agent types from `@aria/core`/`@aria/adapter-corpflow` — none of which exist in the currently-published `v0.3.0` tag. CorpFlow consumes these packages via a git-tag pin (`github:twalibey/aria-core#core-v0.3.0`), a separate repo from this one, so Part 3 cannot proceed without a new tag CorpFlow can point at. This is not optional infrastructure cleanup — it is a real, hard dependency of every task after this one.

**Files:**
- Modify: `packages/core/package.json` (version bump)
- Modify: `packages/adapter-corpflow/package.json` (version bump; also revert the `"*"` workspace-link change from Task 7's Step 0 back to a real git-tag-shaped dependency string, now pointing at the new tag about to be cut)
- Modify (in the CorpFlow repo, not this one): `package.json`, `package-lock.json`

**Sequencing correction made during execution (2026-08-31):** the original Step 3/4/6 order was broken — it tried to repin `adapter-corpflow`'s `@aria/core` dependency to `core-v0.4.0` and `npm install` it (Step 3/4) *before* that tag actually existed on the remote (only created in the original Step 6). A dispatched implementer correctly caught this (`npm ls` after the repin would fail — nothing to resolve), refused to fake a tag or leave the dependency broken, and left the worktree clean. Real constraint: `adapter-corpflow`'s own tag can only be cut *after* it's repinned to the *already-pushed* `core` tag — because an external consumer (CorpFlow) resolving `@aria/adapter-corpflow` from a tag will read that package's own `package.json` and try to resolve its `@aria/core` dependency too; a workspace-only `"*"` spec is meaningless outside this monorepo. This means two separate tag-push moments, not one combined step — corrected below.

- [ ] **Step 1: Confirm the whole ARIA workspace is green**

Run: `cd "/Users/mrdrdaddy/Desktop/Warp Projects/ARIA/.claude/worktrees/aria-corpflow-agents" && npm test && npm run typecheck`
Expected: all green (this re-confirms Tasks 1-7's combined state, not just each task's own isolated run). **Run this from the worktree's own root, not the main checkout** — an earlier version of this step pointed at the wrong path; worktrees have independent working directories and do not share files.

**Known, pre-existing, unrelated flakiness (found and worked around during Task 7.5's first attempt, reproducible on untouched `HEAD` too, not caused by this task):** a plain `npm install` from a fully clean state can race `packages/adapter-corpflow`'s `prepare`/`build` script against npm's workspace-symlink creation for `@aria/core`, causing an intermittent `TS2305` failure unrelated to any code change. If a clean reinstall in this task hits that error, use: `npm install --ignore-scripts`, then `npm run build --workspace=packages/core`, then retry the normal install/build — do not treat this specific failure mode as a real defect in this task's own work.

- [ ] **Step 2: Bump both package versions, commit (adapter-corpflow's `@aria/core` dependency stays `"*"` for now)**

In `packages/core/package.json` and `packages/adapter-corpflow/package.json`, bump `"version"` from `"0.3.0"` to `"0.4.0"` in both files. Do **not** touch `adapter-corpflow`'s `@aria/core` dependency spec yet — it stays `"*"` (from Task 7's Step 0) for this commit; repinning it happens in Step 5, after the `core` tag actually exists.

```bash
cd "/Users/mrdrdaddy/Desktop/Warp Projects/ARIA/.claude/worktrees/aria-corpflow-agents"
npm test && npm run typecheck
git add packages/core/package.json packages/adapter-corpflow/package.json
git commit -m "chore(release): bump @aria/core and @aria/adapter-corpflow to 0.4.0"
```

- [ ] **Step 3: STOP — ask the user before pushing anything**

This is a real, external, shared-state action (pushing a branch and creating/pushing git tags to the public `github.com/twalibey/aria-core` repo). Present the plan: "Part 1/2 of the autonomous-agents work is done and tested locally. Part 3 (the actual Donor Response Agent in CorpFlow) needs new `v0.4.0` tags pushed so CorpFlow can consume them — same as tenant-scoping's mid-plan tag cuts. This needs two separate tag-push steps (core first, then adapter-corpflow once it's repinned to the new core tag). OK to proceed?" Wait for explicit confirmation before Step 4.

- [ ] **Step 4: Push the branch, subtree-split `packages/core`, and tag the split commit — NOT the raw branch tip**

**Second correction made during execution (2026-08-31):** the step below was originally a plain `git tag -a core-v0.4.0 -m "..."` on the worktree branch's own HEAD. That produces a tag whose tree root is the whole monorepo (package name `"aria"`, no `dist/`) — unusable by any external consumer, exactly the failure `packages/core/README.md`'s "Versioning & Distribution" section documents and warns against. Verified directly: `core-v0.3.0` (the tag CorpFlow's CI actually resolves successfully today) IS a proper subtree-split tag — `git clone --branch core-v0.3.0` gives `@aria/core` at the repo root, not the monorepo. Every tag cut in this plan must go through the same `git subtree split` step the README documents, not a raw tag.

```bash
cd "/Users/mrdrdaddy/Desktop/Warp Projects/ARIA/.claude/worktrees/aria-corpflow-agents"
git push origin worktree-aria-corpflow-agents
NEW_SPLIT_COMMIT=$(git subtree split --prefix=packages/core)
git branch -f release-core "$NEW_SPLIT_COMMIT"
git tag -a core-v0.4.0 -m "core-v0.4.0: AgentRunner framework" release-core
git push origin release-core core-v0.4.0
```

Verify before continuing: `git clone --quiet --depth 1 --branch core-v0.4.0 https://github.com/twalibey/aria-core.git /tmp/core-v0.4.0-check && cat /tmp/core-v0.4.0-check/package.json | head -3` must show `"name": "@aria/core"` at the top level (not `"name": "aria"`), and `ls /tmp/core-v0.4.0-check` must show `src/`, `test/`, `package.json` directly (not a `packages/` subdirectory). Clean up the check clone afterward.

- [ ] **Step 5: Repin `adapter-corpflow` to the now-existing `core` tag, reinstall, commit**

In `packages/adapter-corpflow/package.json`, change `"@aria/core": "*"` (set in Task 7's Step 0) to `"@aria/core": "github:twalibey/aria-core#core-v0.4.0"` in both `devDependencies` and `peerDependencies` (confirmed by Task 7's review: no plain `dependencies` block exists for it).

```bash
cd "/Users/mrdrdaddy/Desktop/Warp Projects/ARIA/.claude/worktrees/aria-corpflow-agents"
rm -rf node_modules package-lock.json packages/adapter-corpflow/node_modules
npm install
npm test && npm run typecheck
git add packages/adapter-corpflow/package.json package-lock.json
git commit -m "fix(adapter-corpflow): repin @aria/core to published core-v0.4.0 tag"
```

- [ ] **Step 6: Push the branch again, subtree-split `packages/adapter-corpflow`, and tag the split commit**

Same correction as Step 4 — subtree split, not a raw tag.

```bash
cd "/Users/mrdrdaddy/Desktop/Warp Projects/ARIA/.claude/worktrees/aria-corpflow-agents"
git push origin worktree-aria-corpflow-agents
NEW_SPLIT_COMMIT=$(git subtree split --prefix=packages/adapter-corpflow)
git branch -f release-adapter-corpflow "$NEW_SPLIT_COMMIT"
git tag -a adapter-corpflow-v0.4.0 -m "adapter-corpflow-v0.4.0: createDrizzleAgentActionStore" release-adapter-corpflow
git push origin release-adapter-corpflow adapter-corpflow-v0.4.0
```

Verify the same way as Step 4 before continuing (clone the tag, confirm `"name": "@aria/adapter-corpflow"` at the root, `src/`/`test/`/`package.json` directly present).

(Two separate tags, matching the tenant-scoping precedent's own convention of one tag per package rather than one shared tag — `packages/core/README.md`'s documented dependency examples already assume this per-package tag naming.)

**Third correction made during execution (2026-08-31):** attempting Step 7 found `core-v0.4.0` itself has a real standalone-build defect — `packages/core/package.json` has no `@types/node` devDependency, but Task 2's `agent-action-store-in-memory.ts` imports `node:crypto` (the first file in `packages/core/src` to need it). This is invisible inside the monorepo (hoisted from elsewhere) but breaks `tsc`/`tsup` for an external consumer building the subtree-split tag standalone, with nothing to hoist from. Fixed by adding `"@types/node": "^20.19.0"` (matching the root's own version) to `packages/core/package.json`'s `devDependencies`, then re-cutting `core-v0.4.0` a third time (same tag name, corrected content) — delete, re-subtree-split, re-tag, re-push, following the exact same procedure as Step 4's original re-cut. `adapter-corpflow-v0.4.0` does not need re-cutting (its own `package.json` already lists `@types/node` and doesn't need this fix), but does need re-cutting anyway IF its `package-lock.json`/build output changes as a side effect of core's dist changing shape — check before assuming it's unaffected.

- [ ] **Step 7: Repin CorpFlow's own dependency and reinstall (in the CorpFlow repo/worktree, not this one)**

```bash
cd "/Users/mrdrdaddy/.config/superpowers/worktrees/corpflow/aria-agents"
```

In that repo's `package.json`, change:
```
"@aria/core": "github:twalibey/aria-core#core-v0.3.0"
"@aria/adapter-corpflow": "github:twalibey/aria-core#adapter-corpflow-v0.3.0"
```
to:
```
"@aria/core": "github:twalibey/aria-core#core-v0.4.0"
"@aria/adapter-corpflow": "github:twalibey/aria-core#adapter-corpflow-v0.4.0"
```

Then:
```bash
rm -rf node_modules package-lock.json
npm install
npm ls @aria/core @aria/adapter-corpflow
```
Expected: both resolve to `0.4.0`. If npm still resolves the old tag, this is the exact "editing the git-tag spec string does not force re-resolution" gotcha already documented in project memory — a full clean reinstall (already done above) is the fix; if it persists, check `package-lock.json` was actually deleted, not just regenerated from a cached lockfile entry.

```bash
git add package.json package-lock.json
git commit -m "chore: bump @aria/core and @aria/adapter-corpflow to 0.4.0"
```

---

## Part 3 — CorpFlow repo integration

**Repo for all remaining tasks:** `/Users/mrdrdaddy/Desktop/AI Learning Journey /Coding Projects/CorpFlow/corpflow` (confirmed the current real location, 2026-08-31 — verify with `git remote -v` before starting in case it moves again).

**Before Task 8:** Task 7.5 must be complete — CorpFlow's `@aria/core`/`@aria/adapter-corpflow` dependency repinned to the new tag and reinstalled. Task 8 assumes the new exports are already resolvable; if Task 7.5 hasn't run yet, that is a real blocker to flag, not to route around.

### Task 8: `agent_actions` and `tenant_agent_settings` migration + Drizzle schema

**Files:**
- Create: `supabase/migrations/20260901_agent_actions.sql`
- Modify: `src/lib/db/schema.ts` (add two new `pgTable` definitions, following the file's existing conventions)
- Test: `src/__tests__/db/agent-actions-schema.test.ts`

**Interfaces:**
- Produces: `agentActions` and `tenantAgentSettings` Drizzle table objects, consumed by Task 9 (as the `AgentActionsTableRef` passed into `createDrizzleAgentActionStore`) and Task 10 (the cron job's unclaimed-submissions query).

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260901_agent_actions.sql

CREATE TABLE agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  agent_id text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  draft_content text,
  source_snapshot jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  confirmed_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, agent_id)
);

-- Supports the staff pending-actions queue query (Task 12): find actions
-- for a tenant in a status the UI cares about.
CREATE INDEX agent_actions_tenant_status_idx ON agent_actions (tenant_id, status);

CREATE TABLE tenant_agent_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  agent_id text NOT NULL,
  autonomy_level text NOT NULL DEFAULT 'off',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, agent_id)
);
```

- [ ] **Step 2: Run the migration against the dev/test database**

Run: `npx tsx scripts/run-migration.ts supabase/migrations/20260901_agent_actions.sql` (this repo's real, established single-file migration runner — requires `DATABASE_URL` set in the environment or `.env.local`).

- [ ] **Step 3: Add the Drizzle schema definitions**

In `src/lib/db/schema.ts`, add (matching the file's existing `pgTable` style, e.g. the `donationFormSubmissions` table's conventions):

```typescript
export const agentActions = pgTable("agent_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  agentId: text("agent_id").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  status: text("status").notNull().default("processing"),
  draftContent: text("draft_content"),
  sourceSnapshot: jsonb("source_snapshot"),
  attemptCount: integer("attempt_count").notNull().default(0),
  confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AgentActionRow = typeof agentActions.$inferSelect;
export type NewAgentActionRow = typeof agentActions.$inferInsert;

export const tenantAgentSettings = pgTable("tenant_agent_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  agentId: text("agent_id").notNull(),
  autonomyLevel: text("autonomy_level").notNull().default("off"), // 'off' | 'confirm' | 'auto'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type TenantAgentSettingsRow = typeof tenantAgentSettings.$inferSelect;
```

(If `integer` or `jsonb` aren't already imported at the top of `schema.ts` from `drizzle-orm/pg-core`, add them to the existing import statement — don't add a second import line.)

- [ ] **Step 4: Write a test confirming the schema round-trips**

```typescript
// src/__tests__/db/agent-actions-schema.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { agentActions, tenantAgentSettings, tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

describe("agent_actions / tenant_agent_settings schema", () => {
  it("enforces uniqueness on (source_type, source_id, agent_id)", async () => {
    const [tenant] = await db.select().from(tenants).limit(1);
    if (!tenant) throw new Error("Expected at least one seeded tenant for this test");

    const row = {
      tenantId: tenant.id,
      agentId: "test-schema-check",
      sourceType: "test_source",
      sourceId: crypto.randomUUID(),
      status: "processing",
    };

    await db.insert(agentActions).values(row);

    await expect(db.insert(agentActions).values(row)).rejects.toThrow();

    // cleanup
    await db.delete(agentActions).where(eq(agentActions.agentId, "test-schema-check"));
  });

  it("tenant_agent_settings defaults autonomyLevel to 'off'", async () => {
    const [tenant] = await db.select().from(tenants).limit(1);
    if (!tenant) throw new Error("Expected at least one seeded tenant for this test");

    const [inserted] = await db
      .insert(tenantAgentSettings)
      .values({ tenantId: tenant.id, agentId: "test-schema-check" })
      .returning();

    expect(inserted.autonomyLevel).toBe("off");

    await db.delete(tenantAgentSettings).where(eq(tenantAgentSettings.agentId, "test-schema-check"));
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- --run src/__tests__/db/agent-actions-schema.test.ts`
Expected: PASS (2/2) — requires the migration from Step 2 to have already been applied to the test database

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260901_agent_actions.sql src/lib/db/schema.ts src/__tests__/db/agent-actions-schema.test.ts
git commit -m "feat(db): add agent_actions and tenant_agent_settings tables"
```

---

### Task 9: `donorResponseAgentDefinition`

**Files:**
- Create: `src/lib/agents/donor-response.ts`
- Create: `src/__tests__/lib/donor-response-agent.test.ts`

**Interfaces:**
- Consumes: `AgentDefinition`, `AgentDraftOutput`, `stripMarkdownFence` from `@aria/core` (Task 6); `DonationFormSubmission` type, `donationFormSubmissions`, `tenantAgentSettings` from `src/lib/db/schema.ts` (existing + Task 8); `sendEmail` from `src/lib/email/resend.ts` (existing, exact signature confirmed: `sendEmail({ to, subject, html }): Promise<unknown | null>` — returns `null` on failure, does not throw).
- Produces: `donorResponseAgentDefinition: AgentDefinition<DonorResponseInput>`, `DonorResponseInput` type — consumed by Task 10 (the cron job) and Task 12 (the confirm/reject API endpoints).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/lib/donor-response-agent.test.ts
import { describe, it, expect, vi } from "vitest";
import { donorResponseAgentDefinition, type DonorResponseInput } from "@/lib/agents/donor-response";

const baseInput: DonorResponseInput = {
  donorFirstName: "Ada",
  donorEmail: "ada@example.com",
  amount: "250.00",
  designation: "Youth Literacy",
  priorGiftCount: 0,
  tenantName: "Example Nonprofit",
};

describe("donorResponseAgentDefinition.buildPrompt", () => {
  it("does not reference prior giving history when priorGiftCount is 0", () => {
    const { userPrompt } = donorResponseAgentDefinition.buildPrompt(baseInput);
    expect(userPrompt.toLowerCase()).not.toMatch(/again|another|previous|prior gift/);
    expect(userPrompt).toContain("first");
  });

  it("references prior giving history when priorGiftCount is greater than 0", () => {
    const { userPrompt } = donorResponseAgentDefinition.buildPrompt({ ...baseInput, priorGiftCount: 3 });
    expect(userPrompt).toMatch(/3(rd| gift| prior)/i);
  });

  it("includes the real donation amount and designation in the prompt", () => {
    const { userPrompt } = donorResponseAgentDefinition.buildPrompt(baseInput);
    expect(userPrompt).toContain("250.00");
    expect(userPrompt).toContain("Youth Literacy");
  });
});

describe("donorResponseAgentDefinition.parseOutput", () => {
  it("parses a clean JSON response into draftContent and sourceSnapshot", () => {
    const raw = JSON.stringify({ draftContent: "Thank you, Ada!", sourceSnapshot: { amount: "250.00" } });
    const result = donorResponseAgentDefinition.parseOutput(raw);
    expect(result.draftContent).toBe("Thank you, Ada!");
    expect(result.sourceSnapshot).toEqual({ amount: "250.00" });
  });

  it("tolerates a fenced response with trailing prose (reuses the shared fence parser)", () => {
    const raw = '```json\n{"draftContent":"Thank you, Ada!","sourceSnapshot":{"amount":"250.00"}}\n```\n\nNote: kept it brief.';
    const result = donorResponseAgentDefinition.parseOutput(raw);
    expect(result.draftContent).toBe("Thank you, Ada!");
  });
});

describe("donorResponseAgentDefinition.buildToolArgs", () => {
  it("passes the donor email and draft content through to the send tool", () => {
    const draft = { draftContent: "Thank you!", sourceSnapshot: { donorEmail: "ada@example.com" } };
    const args = donorResponseAgentDefinition.buildToolArgs(draft);
    expect(args.content).toBe("Thank you!");
  });
});

describe("donorResponseAgentDefinition.action (send-donor-followup tool)", () => {
  it("calls sendEmail with the recipient and content, returns success text", async () => {
    vi.doMock("@/lib/email/resend", () => ({
      sendEmail: vi.fn().mockResolvedValue({ id: "email-1" }),
    }));
    const { donorResponseAgentDefinition: freshDefinition } = await import("@/lib/agents/donor-response");
    const handler = (freshDefinition.action as any).handler;
    const result = await handler("agent:donor-response", { to: "ada@example.com", content: "Thank you!" });
    expect(result).toContain("sent");
    vi.doUnmock("@/lib/email/resend");
  });

  it("throws when sendEmail returns null (Resend not configured or send failed)", async () => {
    vi.doMock("@/lib/email/resend", () => ({
      sendEmail: vi.fn().mockResolvedValue(null),
    }));
    const { donorResponseAgentDefinition: freshDefinition } = await import("@/lib/agents/donor-response");
    const handler = (freshDefinition.action as any).handler;
    await expect(handler("agent:donor-response", { to: "ada@example.com", content: "Thank you!" })).rejects.toThrow();
    vi.doUnmock("@/lib/email/resend");
  });
});
```

**Note for the implementer:** this test file imports the real module twice with different mock states (`vi.doMock`/dynamic `import()`), because `sendEmail`'s return-`null`-on-failure behavior (confirmed against the real `resend.ts` source, not assumed) needs the tool handler to explicitly convert that into a thrown error — otherwise `ToolRegistry.execute()`'s `result.success` would be `true` for a send that actually failed silently.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/__tests__/lib/donor-response-agent.test.ts`
Expected: FAIL — cannot resolve `@/lib/agents/donor-response`

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/agents/donor-response.ts
import { stripMarkdownFence, type AgentDefinition, type AgentDraftOutput } from "@aria/core";
import { sendEmail } from "@/lib/email/resend";
import { db } from "@/lib/db";
import { tenantAgentSettings } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export interface DonorResponseInput {
  donorFirstName: string;
  donorEmail: string;
  amount: string;
  designation: string | null;
  priorGiftCount: number;
  tenantName: string;
}

const AGENT_ID = "donor-response";

function buildPrompt(input: DonorResponseInput): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    `You are drafting a short, warm, personal follow-up email on behalf of ${input.tenantName}, a nonprofit organization, to one of its donors.`,
    "This is IN ADDITION TO an automated receipt the donor already sees elsewhere — do not write a receipt or restate payment/transaction details as your primary content; write a genuine, brief thank-you.",
    "Never state a number of prior gifts, a total giving amount, or any fact not explicitly given to you below — if you don't have a fact, don't reference it.",
    "Respond with only JSON, no markdown code fences, no explanation before or after it.",
    'JSON shape: { "draftContent": string, "sourceSnapshot": { "amount": string, "designation": string | null, "priorGiftCount": number } }',
  ].join("\n");

  const historyLine =
    input.priorGiftCount > 0
      ? `This is their ${input.priorGiftCount + 1}${ordinalSuffix(input.priorGiftCount + 1)} gift — you may warmly acknowledge their continued support, but do not invent specific past amounts or dates.`
      : "This is their first gift to this organization — welcome them, do not reference any giving history.";

  const userPrompt = [
    `Donor first name: ${input.donorFirstName}`,
    `Gift amount: ${input.amount}`,
    `Designation/campaign: ${input.designation ?? "General fund"}`,
    historyLine,
  ].join("\n");

  return { systemPrompt, userPrompt };
}

function ordinalSuffix(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "st";
  if (n % 10 === 2 && n % 100 !== 12) return "nd";
  if (n % 10 === 3 && n % 100 !== 13) return "rd";
  return "th";
}

function parseOutput(raw: string): AgentDraftOutput {
  const cleaned = stripMarkdownFence(raw);
  const parsed = JSON.parse(cleaned) as { draftContent: string; sourceSnapshot: Record<string, unknown> };
  return { draftContent: parsed.draftContent, sourceSnapshot: parsed.sourceSnapshot };
}

export const donorResponseAgentDefinition: AgentDefinition<DonorResponseInput> = {
  id: AGENT_ID,
  sourceType: "donation_form_submission",
  buildPrompt,
  parseOutput,
  action: {
    name: "send-donor-followup",
    description: "Sends a personalized donor follow-up email",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        content: { type: "string" },
      },
      required: ["to", "content"],
    },
    // Not a chat-context mutation (no ChatEngine cache involved here) —
    // false is correct, not merely the default.
    mutatesContext: false,
  },
  buildToolArgs: (draft) => ({
    to: draft.sourceSnapshot.donorEmail,
    content: draft.draftContent,
  }),
  checkAutonomy: async (tenantId) => {
    const [row] = await db
      .select()
      .from(tenantAgentSettings)
      .where(and(eq(tenantAgentSettings.tenantId, tenantId), eq(tenantAgentSettings.agentId, AGENT_ID)))
      .limit(1);
    return (row?.autonomyLevel as "off" | "confirm" | "auto" | undefined) ?? "off";
  },
};

// The actual tool handler — registered separately from the ToolDefinition
// metadata above because ToolRegistry.register() expects a Tool<TArgs> =
// { definition, handler }, and `action` here is only the definition half
// (AgentDefinition.action is typed as ToolDefinition, not Tool). Task 10
// registers { definition: donorResponseAgentDefinition.action, handler:
// sendDonorFollowupHandler } with a ToolRegistry before running the agent.
export async function sendDonorFollowupHandler(
  _userId: string,
  args: Record<string, unknown>
): Promise<string> {
  const { to, content } = args as { to: string; content: string };
  const result = await sendEmail({
    to,
    subject: "Thank you for your gift",
    html: `<p>${content}</p>`,
  });
  if (!result) {
    throw new Error("sendEmail failed or Resend is not configured");
  }
  return `sent to ${to}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run src/__tests__/lib/donor-response-agent.test.ts`
Expected: PASS (9/9)

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/donor-response.ts src/__tests__/lib/donor-response-agent.test.ts
git commit -m "feat(agents): add donorResponseAgentDefinition"
```

---

### Task 10: Slack alerts for pending drafts and cron-job failures

**Files:**
- Modify: `src/lib/slack/notifications.ts` (add two new functions, following the existing `notifyTenantScopingViolation` pattern in the same file — read it first to match its exact style/signature conventions)
- Test: `src/__tests__/lib/slack-agent-notifications.test.ts`

**Interfaces:**
- Produces: `notifyAgentActionPending(tenantName: string, agentId: string, actionId: string): Promise<void>`, `notifyAgentJobFailure(jobName: string, error: string): Promise<void>` — consumed by Task 11 (cron job).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/lib/slack-agent-notifications.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendSlackMessageMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/slack/client", () => ({
  sendSlackMessage: sendSlackMessageMock,
}));

import { notifyAgentActionPending, notifyAgentJobFailure } from "@/lib/slack/notifications";

const ORIGINAL_ENV = process.env.SLACK_ADMIN_ALERTS_CHANNEL;

describe("notifyAgentActionPending", () => {
  beforeEach(() => {
    sendSlackMessageMock.mockClear();
    process.env.SLACK_ADMIN_ALERTS_CHANNEL = "C123ADMIN";
  });
  afterEach(() => {
    process.env.SLACK_ADMIN_ALERTS_CHANNEL = ORIGINAL_ENV;
  });

  it("posts a message including the tenant name, agent id, and action id", async () => {
    await notifyAgentActionPending("Example Nonprofit", "donor-response", "action-123");
    expect(sendSlackMessageMock).toHaveBeenCalledTimes(1);
    const [channel, message] = sendSlackMessageMock.mock.calls[0];
    expect(channel).toBe("C123ADMIN");
    expect(message).toContain("Example Nonprofit");
    expect(message).toContain("donor-response");
    expect(message).toContain("action-123");
  });

  it("no-ops when SLACK_ADMIN_ALERTS_CHANNEL is not configured", async () => {
    delete process.env.SLACK_ADMIN_ALERTS_CHANNEL;
    await notifyAgentActionPending("Example Nonprofit", "donor-response", "action-123");
    expect(sendSlackMessageMock).not.toHaveBeenCalled();
  });
});

describe("notifyAgentJobFailure", () => {
  beforeEach(() => {
    sendSlackMessageMock.mockClear();
    process.env.SLACK_ADMIN_ALERTS_CHANNEL = "C123ADMIN";
  });
  afterEach(() => {
    process.env.SLACK_ADMIN_ALERTS_CHANNEL = ORIGINAL_ENV;
  });

  it("posts a message including the job name and error text", async () => {
    await notifyAgentJobFailure("donor-response-agent", "DB connection refused");
    expect(sendSlackMessageMock).toHaveBeenCalledTimes(1);
    const [, message] = sendSlackMessageMock.mock.calls[0];
    expect(message).toContain("donor-response-agent");
    expect(message).toContain("DB connection refused");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/__tests__/lib/slack-agent-notifications.test.ts`
Expected: FAIL — the two new functions don't exist yet

- [ ] **Step 3: Add the two functions to `src/lib/slack/notifications.ts`**

Verified against the real file: it already has a module-level `getChannel()` helper (checks `process.env.SLACK_ADMIN_ALERTS_CHANNEL`, warns and returns `null` if unset) and calls `sendSlackMessage(channel, text)` from `./client` — every existing notifier (`notifyFileUploaded`, `notifyPaymentReceived`, `notifyTenantScopingViolation`, etc.) follows this exact same three-line shape. Add these two functions at the end of the file, matching it exactly:

```typescript
export async function notifyAgentActionPending(
  tenantName: string,
  agentId: string,
  actionId: string
) {
  const channel = getChannel();
  if (!channel) return;

  await sendSlackMessage(
    channel,
    `New agent draft awaiting review for ${tenantName} — agent: ${agentId}, action: ${actionId}`
  );
}

export async function notifyAgentJobFailure(jobName: string, error: string) {
  const channel = getChannel();
  if (!channel) return;

  await sendSlackMessage(
    channel,
    `🚨 Agent cron job "${jobName}" failed: ${error}`
  );
}
```

No changes needed to the file's existing imports (`sendSlackMessage` from `./client` and the module-level `getChannel()` are already in scope for every function in this file).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run src/__tests__/lib/slack-agent-notifications.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add src/lib/slack/notifications.ts src/__tests__/lib/slack-agent-notifications.test.ts
git commit -m "feat(slack): add agent pending-draft and job-failure notifications"
```

---

### Task 11: Donor Response Agent cron job

**Files:**
- Modify: `src/app/api/cron/[job]/route.ts` (add a new `donor-response-agent` entry to `CRON_JOBS`)
- Modify: `vercel.json` (add the new cron schedule entry)
- Test: `src/__tests__/api/cron-donor-response-agent.test.ts`

**Interfaces:**
- Consumes: `AgentRunner`, `InMemoryAgentActionStore`'s real counterpart (`createDrizzleAgentActionStore` from Task 7 + `agentActions` table from Task 8), `donorResponseAgentDefinition`/`sendDonorFollowupHandler` (Task 9), `notifyAgentActionPending`/`notifyAgentJobFailure` (Task 10), `donationFormSubmissions` (existing schema).

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/api/cron-donor-response-agent.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
  },
}));
vi.mock("@/lib/slack/notifications", () => ({
  notifyAgentActionPending: vi.fn(),
  notifyAgentJobFailure: vi.fn(),
}));

import { runDonorResponseAgentJob } from "@/app/api/cron/[job]/route";
import { db } from "@/lib/db";
import { notifyAgentActionPending } from "@/lib/slack/notifications";

describe("runDonorResponseAgentJob", () => {
  it("processes each unclaimed submission and reports a summary", async () => {
    const selectChain = {
      from: () => ({
        leftJoin: () => ({
          where: async () => [
            {
              donation_form_submissions: {
                id: "sub-1",
                tenantId: "tenant-1",
                donorFirstName: "Ada",
                donorEmail: "ada@example.com",
                amount: "250.00",
                designation: "Youth Literacy",
              },
            },
          ],
        }),
      }),
    };
    (db.select as any).mockReturnValue(selectChain);

    const result = await runDonorResponseAgentJob();

    expect(result.message).toContain("1");
    expect(notifyAgentActionPending).toHaveBeenCalled();
  });

  it("reports zero processed when there are no unclaimed submissions", async () => {
    const selectChain = {
      from: () => ({
        leftJoin: () => ({
          where: async () => [],
        }),
      }),
    };
    (db.select as any).mockReturnValue(selectChain);

    const result = await runDonorResponseAgentJob();

    expect(result.message).toContain("0");
  });
});
```

**Note for the implementer:** the exact shape of "find `donation_form_submissions` rows with no matching `agent_actions` row" (a `leftJoin` + `where agent_actions.id is null`, or a `notExists` subquery) should follow whichever pattern is more idiomatic for the Drizzle version already in this repo's `package.json` — check an existing multi-table query elsewhere in `src/app/api/` for the established convention before choosing, and adjust this test's mock shape to match whatever real query shape you write (the mock above is illustrative of the join approach, not a hard requirement).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/__tests__/api/cron-donor-response-agent.test.ts`
Expected: FAIL — `runDonorResponseAgentJob` is not exported yet

- [ ] **Step 3: Implement the job and register it**

In `src/app/api/cron/[job]/route.ts`, add these imports (alongside the file's existing ones):

```typescript
import { AgentRunner, ToolRegistry, OpenRouterProvider } from "@aria/core";
import { createDrizzleAgentActionStore } from "@aria/adapter-corpflow";
import { agentActions, donationFormSubmissions, tenants } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { donorResponseAgentDefinition, sendDonorFollowupHandler } from "@/lib/agents/donor-response";
import { notifyAgentActionPending, notifyAgentJobFailure } from "@/lib/slack/notifications";
```

Then add:

```typescript
export async function runDonorResponseAgentJob(): Promise<{ message: string }> {
  const unclaimed = await db
    .select()
    .from(donationFormSubmissions)
    .leftJoin(
      agentActions,
      and(eq(agentActions.sourceId, donationFormSubmissions.id), eq(agentActions.agentId, "donor-response"))
    )
    .where(isNull(agentActions.id));

  const registry = new ToolRegistry();
  registry.register({ definition: donorResponseAgentDefinition.action, handler: sendDonorFollowupHandler });
  const actionStore = createDrizzleAgentActionStore(db as any, agentActions as any);
  // CorpFlow's real production AI client (src/lib/ai/client.ts) reads
  // OPENROUTER_API_KEY, not ANTHROPIC_API_KEY — @aria/core's OpenRouterProvider
  // (already a dependency here, exported from the core package since Phase 1)
  // is used directly so this agent authenticates the same way every other
  // AI call in this repo already does, rather than requiring a second key.
  const llmProvider = new OpenRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY! });
  const runner = new AgentRunner(
    llmProvider,
    registry,
    actionStore,
    (params) => console.error(`[agent:${params.agentId}]`, params.error)
  );

  let processed = 0;
  let pending = 0;

  for (const row of unclaimed) {
    const submission = row.donation_form_submissions;
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, submission.tenantId)).limit(1);

    const priorGiftCount = await db
      .select()
      .from(donationFormSubmissions)
      .where(
        and(
          eq(donationFormSubmissions.donorEmail, submission.donorEmail),
          eq(donationFormSubmissions.tenantId, submission.tenantId)
        )
      )
      .then((rows) => rows.filter((r) => r.id !== submission.id).length);

    const result = await runner.run(
      donorResponseAgentDefinition,
      {
        donorFirstName: submission.donorFirstName,
        donorEmail: submission.donorEmail,
        amount: submission.amount,
        designation: submission.designation,
        priorGiftCount,
        tenantName: tenant?.name ?? "your organization",
      },
      submission.tenantId,
      submission.id
    );

    processed++;
    if (result.status === "pending_confirm" && result.action) {
      pending++;
      await notifyAgentActionPending(tenant?.name ?? submission.tenantId, "donor-response", result.action.id);
    }
  }

  return { message: `Donor response agent: processed ${processed}, ${pending} pending confirm` };
}
```

Register the job in `CRON_JOBS`:

```typescript
const CRON_JOBS: Record<string, () => Promise<{ message: string }>> = {
  heartbeat: async () => { /* ...unchanged... */ },
  "good-standing-check": async () => { /* ...unchanged... */ },
  "donor-response-agent": runDonorResponseAgentJob,
};
```

Wrap the job's invocation inside the route's existing top-level `try/catch` (already present in `GET`) — no change needed there, but confirm the catch block's `notifyAgentJobFailure` call is added:

In the existing `catch (error)` block of `GET`, after the existing `console.error`, add a conditional call so a `donor-response-agent` failure specifically alerts Slack (the two pre-existing jobs don't need this — only wire it for the new job, matching the spec's "cron-job-level failure" requirement):

```typescript
    if (job === "donor-response-agent") {
      await notifyAgentJobFailure(job, message);
    }
```

In `vercel.json`, add a new entry to the `crons` array:

```json
{ "path": "/api/cron/donor-response-agent", "schedule": "*/15 * * * *" }
```

(Confirm the real `vercel.json`'s cron entries use `path: "/api/cron/<job>"` exactly as shown — matching the existing `heartbeat` entry's format — before adding this.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run src/__tests__/api/cron-donor-response-agent.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/[job]/route.ts vercel.json src/__tests__/api/cron-donor-response-agent.test.ts
git commit -m "feat(cron): add donor-response-agent job"
```

---

### Task 12: Staff-facing approve/reject API endpoints

**Files:**
- Create: `src/app/api/agents/actions/route.ts` (list pending actions for the caller's tenant)
- Create: `src/app/api/agents/actions/[id]/approve/route.ts`
- Create: `src/app/api/agents/actions/[id]/reject/route.ts`
- Test: `src/__tests__/api/agent-actions.test.ts`

**Interfaces:**
- Consumes: `requireRole` from `src/lib/auth/verify.ts` (existing, same pattern as `nl-query`'s `admin/super_admin/manager` gate), `AgentRunner.confirmAndExecute`/`reject` (Task 5), `donorResponseAgentDefinition` (Task 9).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/api/agent-actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

class FakeAuthError extends Error {
  constructor(message: string, public statusCode: number = 401) {
    super(message);
    this.name = "AuthError";
  }
}

vi.mock("@/lib/auth/verify", () => ({
  verifyAuth: vi.fn(),
  requireRole: vi.fn(),
  AuthError: FakeAuthError,
}));
vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), update: vi.fn() } }));

import { verifyAuth, requireRole } from "@/lib/auth/verify";
import { GET as listActions } from "@/app/api/agents/actions/route";
import { POST as approveAction } from "@/app/api/agents/actions/[id]/approve/route";
import { POST as rejectAction } from "@/app/api/agents/actions/[id]/reject/route";
import { NextRequest } from "next/server";

describe("GET /api/agents/actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for a user without an allowed role", async () => {
    (verifyAuth as any).mockResolvedValue({ id: "user-1", tenantId: "tenant-1", role: "staff" });
    (requireRole as any).mockImplementation(() => {
      throw new FakeAuthError("Insufficient permissions", 403);
    });

    const req = new NextRequest("http://localhost/api/agents/actions");
    const res = await listActions(req);

    expect(res.status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), "admin", "super_admin", "manager");
  });
});

describe("POST /api/agents/actions/[id]/approve", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for a user without an allowed role", async () => {
    (verifyAuth as any).mockResolvedValue({ id: "user-1", tenantId: "tenant-1", role: "staff" });
    (requireRole as any).mockImplementation(() => {
      throw new FakeAuthError("Insufficient permissions", 403);
    });

    const req = new NextRequest("http://localhost/api/agents/actions/action-1/approve", { method: "POST" });
    const res = await approveAction(req, { params: Promise.resolve({ id: "action-1" }) });

    expect(res.status).toBe(403);
  });
});

describe("POST /api/agents/actions/[id]/reject", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for a user without an allowed role", async () => {
    (verifyAuth as any).mockResolvedValue({ id: "user-1", tenantId: "tenant-1", role: "staff" });
    (requireRole as any).mockImplementation(() => {
      throw new FakeAuthError("Insufficient permissions", 403);
    });

    const req = new NextRequest("http://localhost/api/agents/actions/action-1/reject", { method: "POST" });
    const res = await rejectAction(req, { params: Promise.resolve({ id: "action-1" }) });

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/__tests__/api/agent-actions.test.ts`
Expected: FAIL — the three route files don't exist yet

- [ ] **Step 3: Implement the three routes**

Verified against the real `src/app/api/ai/nl-query/route.ts`: the established pattern is `verifyAuth()` → `requireRole(user, "admin", "super_admin", "manager")` → work → a catch block that checks `err instanceof AuthError` first (returns `err.statusCode`), then `err instanceof z.ZodError` (400), then a generic 500. All three new routes below copy that exact catch shape.

```typescript
// src/app/api/agents/actions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, requireRole, AuthError } from "@/lib/auth/verify";
import { db } from "@/lib/db";
import { agentActions } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export async function GET(_req: NextRequest) {
  try {
    const user = await verifyAuth();
    requireRole(user, "admin", "super_admin", "manager");

    const rows = await db
      .select()
      .from(agentActions)
      .where(
        and(
          eq(agentActions.tenantId, user.tenantId),
          inArray(agentActions.status, ["pending_confirm", "needs_attention", "send_failed"])
        )
      );

    return NextResponse.json({ actions: rows });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("Failed to list agent actions:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

```typescript
// src/app/api/agents/actions/[id]/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, requireRole, AuthError } from "@/lib/auth/verify";
import { AgentRunner, ToolRegistry } from "@aria/core";
import { createDrizzleAgentActionStore } from "@aria/adapter-corpflow";
import { db } from "@/lib/db";
import { agentActions } from "@/lib/db/schema";
import { donorResponseAgentDefinition, sendDonorFollowupHandler } from "@/lib/agents/donor-response";
import { z } from "zod";

const bodySchema = z.object({ editedContent: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await verifyAuth();
    requireRole(user, "admin", "super_admin", "manager");
    const { id } = await params;
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    const registry = new ToolRegistry();
    registry.register({ definition: donorResponseAgentDefinition.action, handler: sendDonorFollowupHandler });
    const actionStore = createDrizzleAgentActionStore(db as any, agentActions as any);
    const runner = new AgentRunner({ call: async () => ({ content: "{}" }) }, registry, actionStore);

    const updated = await runner.confirmAndExecute(
      donorResponseAgentDefinition,
      id,
      user.tenantId,
      user.id,
      { editedContent: body.editedContent }
    );

    return NextResponse.json({ action: updated });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    console.error("Failed to approve agent action:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

**Note on the `AgentRunner` constructed above:** `confirmAndExecute` never calls `llmProvider.call(...)` (it acts on the already-drafted content, not a fresh draft) — the stub `{ call: async () => ({ content: "{}" }) }` is deliberate, not a placeholder standing in for missing work, since a real `OpenRouterProvider` would need `OPENROUTER_API_KEY` on every request to this route for no reason. If a future task changes `confirmAndExecute` to ever call the LLM, this stub must be replaced with the real `OpenRouterProvider` from Task 11 at that time — flagged here so it isn't missed.

```typescript
// src/app/api/agents/actions/[id]/reject/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, requireRole, AuthError } from "@/lib/auth/verify";
import { AgentRunner, ToolRegistry } from "@aria/core";
import { createDrizzleAgentActionStore } from "@aria/adapter-corpflow";
import { db } from "@/lib/db";
import { agentActions } from "@/lib/db/schema";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await verifyAuth();
    requireRole(user, "admin", "super_admin", "manager");
    const { id } = await params;

    const registry = new ToolRegistry();
    const actionStore = createDrizzleAgentActionStore(db as any, agentActions as any);
    const runner = new AgentRunner({ call: async () => ({ content: "{}" }) }, registry, actionStore);

    const updated = await runner.reject(id, user.tenantId);

    return NextResponse.json({ action: updated });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("Failed to reject agent action:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run src/__tests__/api/agent-actions.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agents/actions/route.ts src/app/api/agents/actions/[id]/approve/route.ts src/app/api/agents/actions/[id]/reject/route.ts src/__tests__/api/agent-actions.test.ts
git commit -m "feat(api): add agent pending-actions list/approve/reject endpoints"
```

---

### Task 13: Staff-facing pending-actions queue page

**Files:**
- Create: `src/app/(dashboard)/agents/actions/page.tsx`
- Create: `src/components/agents/pending-action-card.tsx`
- Test: `src/__tests__/components/pending-action-card.test.tsx`

**Interfaces:**
- Consumes: `GET /api/agents/actions`, `POST /api/agents/actions/[id]/approve`, `POST /api/agents/actions/[id]/reject` (Task 12).

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components/pending-action-card.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PendingActionCard } from "@/components/agents/pending-action-card";

const action = {
  id: "action-1",
  agentId: "donor-response",
  draftContent: "Thank you so much, Ada, for your generous gift!",
  sourceSnapshot: { amount: "250.00", designation: "Youth Literacy", priorGiftCount: 0 },
  status: "pending_confirm",
};

describe("PendingActionCard", () => {
  it("renders the draft content alongside the real source facts, not just the prose", () => {
    render(<PendingActionCard action={action} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText(/thank you so much, ada/i)).toBeInTheDocument();
    expect(screen.getByText(/250\.00/)).toBeInTheDocument();
    expect(screen.getByText(/youth literacy/i)).toBeInTheDocument();
  });

  it("calls onApprove with the action id when Approve is clicked", async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<PendingActionCard action={action} onApprove={onApprove} onReject={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith("action-1", undefined));
  });

  it("calls onReject with the action id when Reject is clicked", async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(<PendingActionCard action={action} onApprove={vi.fn()} onReject={onReject} />);
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    await waitFor(() => expect(onReject).toHaveBeenCalledWith("action-1"));
  });

  it("lets staff edit the draft and passes the edited content on approve", async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<PendingActionCard action={action} onApprove={onApprove} onReject={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Edited thank-you text." } });
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith("action-1", "Edited thank-you text."));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/__tests__/components/pending-action-card.test.tsx`
Expected: FAIL — cannot resolve `@/components/agents/pending-action-card`

- [ ] **Step 3: Write the component**

```tsx
// src/components/agents/pending-action-card.tsx
"use client";

import { useState } from "react";

interface PendingActionCardProps {
  action: {
    id: string;
    agentId: string;
    draftContent: string | null;
    sourceSnapshot: Record<string, unknown> | null;
    status: string;
  };
  onApprove: (id: string, editedContent?: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export function PendingActionCard({ action, onApprove, onReject }: PendingActionCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(action.draftContent ?? "");

  const handleApprove = async () => {
    const edited = editing && draft !== action.draftContent ? draft : undefined;
    await onApprove(action.id, edited);
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="text-sm text-muted-foreground">Agent: {action.agentId}</div>

      {editing ? (
        <textarea
          className="w-full border rounded p-2 text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <p className="text-sm whitespace-pre-wrap">{action.draftContent}</p>
      )}

      {action.sourceSnapshot && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground border-t pt-2">
          {Object.entries(action.sourceSnapshot).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="font-medium">{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex gap-2">
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-sm underline">
            Edit
          </button>
        )}
        <button type="button" onClick={handleApprove} className="text-sm font-medium">
          Approve
        </button>
        <button type="button" onClick={() => onReject(action.id)} className="text-sm text-destructive">
          Reject
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run src/__tests__/components/pending-action-card.test.tsx`
Expected: PASS (4/4)

- [ ] **Step 5: Write the page that fetches and lists actions**

```tsx
// src/app/(dashboard)/agents/actions/page.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { PendingActionCard } from "@/components/agents/pending-action-card";

interface AgentActionRow {
  id: string;
  agentId: string;
  draftContent: string | null;
  sourceSnapshot: Record<string, unknown> | null;
  status: string;
}

export default function AgentActionsPage() {
  const [actions, setActions] = useState<AgentActionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/agents/actions");
    const data = await res.json();
    setActions(data.actions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async (id: string, editedContent?: string) => {
    await fetch(`/api/agents/actions/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editedContent }),
    });
    await load();
  };

  const handleReject = async (id: string) => {
    await fetch(`/api/agents/actions/${id}/reject`, { method: "POST" });
    await load();
  };

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Pending Agent Actions</h1>
      {actions.length === 0 && <p className="text-muted-foreground">Nothing pending.</p>}
      {actions.map((action) => (
        <PendingActionCard key={action.id} action={action} onApprove={handleApprove} onReject={handleReject} />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/agents/actions/page.tsx src/components/agents/pending-action-card.tsx src/__tests__/components/pending-action-card.test.tsx
git commit -m "feat(ui): add staff-facing pending agent actions queue page"
```

---

### Task 14: Autonomy-level settings API + toggle UI

**Files:**
- Create: `src/app/api/agents/settings/route.ts` — mirrors the real, verified `src/app/api/approvals/settings/route.ts` pattern exactly (GET does an upsert-then-select via `onConflictDoNothing`, PATCH validates with Zod then updates)
- Create: `src/components/agents/agent-autonomy-toggle.tsx`
- Test: `src/__tests__/api/agent-settings.test.ts`

**Interfaces:**
- Consumes: `tenantAgentSettings` (Task 8), same `verifyAuth`/`requireRole`/`AuthError` pattern as Task 12.

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/api/agent-settings.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

class FakeAuthError extends Error {
  constructor(message: string, public statusCode: number = 401) {
    super(message);
    this.name = "AuthError";
  }
}

vi.mock("@/lib/auth/verify", () => ({
  verifyAuth: vi.fn(),
  requireRole: vi.fn(),
  AuthError: FakeAuthError,
}));

const insertMock = vi.fn();
const selectMock = vi.fn();
const updateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    insert: (...args: unknown[]) => insertMock(...args),
    select: (...args: unknown[]) => selectMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}));

import { verifyAuth, requireRole } from "@/lib/auth/verify";
import { GET, PATCH } from "@/app/api/agents/settings/route";
import { NextRequest } from "next/server";

describe("GET /api/agents/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReturnValue({
      values: () => ({ onConflictDoNothing: () => Promise.resolve() }),
    });
    selectMock.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ tenantId: "tenant-1", agentId: "donor-response", autonomyLevel: "off" }]) }) }),
    });
  });

  it("returns the current autonomy level for the tenant", async () => {
    (verifyAuth as any).mockResolvedValue({ id: "user-1", tenantId: "tenant-1", role: "admin" });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.autonomyLevel).toBe("off");
  });
});

describe("PATCH /api/agents/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReturnValue({
      values: () => ({ onConflictDoNothing: () => Promise.resolve() }),
    });
    updateMock.mockReturnValue({
      set: () => ({ where: () => Promise.resolve() }),
    });
    selectMock.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ tenantId: "tenant-1", agentId: "donor-response", autonomyLevel: "auto" }]) }) }),
    });
  });

  it("returns 403 for a user without an allowed role", async () => {
    (verifyAuth as any).mockResolvedValue({ id: "user-1", tenantId: "tenant-1", role: "staff" });
    (requireRole as any).mockImplementation(() => {
      throw new FakeAuthError("Insufficient permissions", 403);
    });

    const req = new NextRequest("http://localhost/api/agents/settings", {
      method: "PATCH",
      body: JSON.stringify({ autonomyLevel: "auto" }),
    });
    const res = await PATCH(req);

    expect(res.status).toBe(403);
  });

  it("rejects an invalid autonomyLevel value", async () => {
    (verifyAuth as any).mockResolvedValue({ id: "user-1", tenantId: "tenant-1", role: "admin" });
    (requireRole as any).mockImplementation(() => {});

    const req = new NextRequest("http://localhost/api/agents/settings", {
      method: "PATCH",
      body: JSON.stringify({ autonomyLevel: "sometimes" }),
    });
    const res = await PATCH(req);

    expect(res.status).toBe(400);
  });

  it("updates and returns the new autonomy level for a valid request", async () => {
    (verifyAuth as any).mockResolvedValue({ id: "user-1", tenantId: "tenant-1", role: "admin" });
    (requireRole as any).mockImplementation(() => {});

    const req = new NextRequest("http://localhost/api/agents/settings", {
      method: "PATCH",
      body: JSON.stringify({ autonomyLevel: "auto" }),
    });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.autonomyLevel).toBe("auto");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/__tests__/api/agent-settings.test.ts`
Expected: FAIL — `@/app/api/agents/settings/route` doesn't exist yet

- [ ] **Step 3: Write the route, mirroring `approvals/settings/route.ts` exactly**

```typescript
// src/app/api/agents/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, requireRole, AuthError } from "@/lib/auth/verify";
import { db } from "@/lib/db";
import { tenantAgentSettings } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const AGENT_ID = "donor-response";

const updateSettingsSchema = z.object({
  autonomyLevel: z.enum(["off", "confirm", "auto"]),
});

export async function GET() {
  try {
    const user = await verifyAuth();
    const tenantId = user.tenantId;

    await db
      .insert(tenantAgentSettings)
      .values({ tenantId, agentId: AGENT_ID })
      .onConflictDoNothing();
    const [settings] = await db
      .select()
      .from(tenantAgentSettings)
      .where(and(eq(tenantAgentSettings.tenantId, tenantId), eq(tenantAgentSettings.agentId, AGENT_ID)))
      .limit(1);

    return NextResponse.json({ data: settings });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("Failed to load agent settings:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await verifyAuth();
    requireRole(user, "admin", "super_admin");

    const tenantId = user.tenantId;
    const body = await req.json();
    const { autonomyLevel } = updateSettingsSchema.parse(body);

    await db
      .insert(tenantAgentSettings)
      .values({ tenantId, agentId: AGENT_ID })
      .onConflictDoNothing();
    await db
      .update(tenantAgentSettings)
      .set({ autonomyLevel })
      .where(and(eq(tenantAgentSettings.tenantId, tenantId), eq(tenantAgentSettings.agentId, AGENT_ID)));

    const [updated] = await db
      .select()
      .from(tenantAgentSettings)
      .where(and(eq(tenantAgentSettings.tenantId, tenantId), eq(tenantAgentSettings.agentId, AGENT_ID)))
      .limit(1);

    return NextResponse.json({ data: updated });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    console.error("Failed to update agent settings:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

(This deliberately restricts write access to `admin`/`super_admin` — one narrower than the `admin`/`super_admin`/`manager` read/approve/reject gate in Tasks 12 — enabling full autonomy for a donor-facing agent is a bigger decision than approving one draft, and `approvals/settings/route.ts`'s own `PATCH` uses this same narrower two-role list, not the three-role one.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run src/__tests__/api/agent-settings.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Write a small toggle component**

```tsx
// src/components/agents/agent-autonomy-toggle.tsx
"use client";

import { useEffect, useState, useCallback } from "react";

type AutonomyLevel = "off" | "confirm" | "auto";

export function AgentAutonomyToggle() {
  const [level, setLevel] = useState<AutonomyLevel>("off");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/agents/settings");
    const data = await res.json();
    setLevel(data.data?.autonomyLevel ?? "off");
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = async (next: AutonomyLevel) => {
    setLevel(next);
    await fetch("/api/agents/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autonomyLevel: next }),
    });
  };

  if (loading) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Donor Response Agent</h3>
      <div className="flex gap-2">
        {(["off", "confirm", "auto"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => handleChange(option)}
            className={level === option ? "font-semibold underline" : "text-muted-foreground"}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/agents/settings/route.ts src/components/agents/agent-autonomy-toggle.tsx src/__tests__/api/agent-settings.test.ts
git commit -m "feat(settings): add donor response agent autonomy level API and toggle"
```

---

### Task 15: RISK-005, documentation, and full-workspace verification

**Files:**
- Modify: `/Users/mrdrdaddy/Desktop/Warp Projects/ARIA/RISK-REGISTER.md`
- Create: `packages/adapter-corpflow/scripts/live-donor-response-agent-smoke-test.ts` (manual, not part of CI — mirrors `live-tenant-scoping-smoke-test.ts`'s structure and doc-comment style exactly)

- [ ] **Step 1: File RISK-005 in ARIA's `RISK-REGISTER.md`**

Add a new entry, matching the existing RISK-001 through RISK-004 format exactly (Status/Filed/Source/Description/Likelihood/Impact/Action/Blocking fields):

```markdown
## RISK-005: Donor Response Agent's follow-up email has no separate consent/opt-out mechanism

**Status:** Open
**Filed:** 2026-08-31
**Source:** Gap analysis during the CorpFlow autonomous-agents design (2026-08-31)

**Description:** The Donor Response Agent's personalized follow-up email is treated as transactional (tied directly to a specific gift the donor just made), reusing the same consent basis as a payment receipt, rather than being given its own opt-out/preference mechanism as semi-marketing content. Not verified against real legal/compliance review — a reasonable-sounding assumption, not a confirmed one.

**Likelihood:** Medium (depends on jurisdiction-specific email-consent rules not yet researched)
**Impact:** Medium (regulatory/compliance exposure if the transactional classification turns out to be wrong; donor trust exposure if this reads as unwanted marketing)

**Action:** Have counsel review whether this follow-up email requires its own consent basis distinct from the donation receipt, before this handles real donor communications at meaningful scale.

**Blocking:** Not blocking this plan's initial build. Blocking before real donor data flows through this feature at production scale.

---
```

- [ ] **Step 2: Write the manual live-model smoke test script**

Mirror `packages/adapter-corpflow/scripts/live-tenant-scoping-smoke-test.ts`'s structure exactly (doc comment explaining primary purpose, `buildProvider()` helper reading `ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`, a `main()` that runs a few real scenarios and logs pass/fail): exercise `donorResponseAgentDefinition.buildPrompt`/`parseOutput` against a real LLM call for three cases — a first-time donor (`priorGiftCount: 0`, assert the response never mentions "again"/"another"/a specific prior count), a repeat donor (`priorGiftCount: 3`, assert it does reference returning support without fabricating specifics), and confirm the response survives `parseOutput` (the shared fence-tolerant parser) cleanly in both cases. This script requires a real API key and is not run in CI — same as its two predecessors.

- [ ] **Step 3: Run the smoke test manually**

Run: `cd "/Users/mrdrdaddy/Desktop/Warp Projects/ARIA" && npx tsx packages/adapter-corpflow/scripts/live-donor-response-agent-smoke-test.ts` (requires `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` set in the environment first)
Expected: both scenarios pass; if either fails, that is a real finding to fix before this task is done, not a result to note and move past — same standing lesson this project has now learned three times.

- [ ] **Step 4: Run the full ARIA workspace suite and typecheck**

Run: `cd "/Users/mrdrdaddy/Desktop/Warp Projects/ARIA" && npm test && npm run typecheck`
Expected: all green

- [ ] **Step 5: Run CorpFlow's full test suite and typecheck**

Run: `cd "/Users/mrdrdaddy/Desktop/AI Learning Journey /Coding Projects/CorpFlow/corpflow" && npm run type-check && npm run test -- --run`
Expected: all green

- [ ] **Step 6: Commit**

```bash
cd "/Users/mrdrdaddy/Desktop/Warp Projects/ARIA"
git add RISK-REGISTER.md packages/adapter-corpflow/scripts/live-donor-response-agent-smoke-test.ts
git commit -m "docs: file RISK-005, add live donor-response-agent smoke test script"
```
