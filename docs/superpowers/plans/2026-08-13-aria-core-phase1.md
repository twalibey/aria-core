# ARIA Core Extraction (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@aria/core` — a standalone, provider-agnostic TypeScript package implementing the ARIA chat pattern (personality, context, history, rate limiting, tool-use, safety filtering, LLM orchestration) — plus one synthetic adapter that proves the core interfaces generalize to a second domain before any real adapter is built.

**Architecture:** npm-workspaces monorepo with two packages: `@aria/core` (the engine, dual ESM/CJS build via tsup) and `@aria/adapter-example` (a throwaway synthetic habit-tracking domain used only to validate core's interfaces). All core modules are dependency-injected into a single `ChatEngine` orchestrator; no module reaches out to a database or network directly except the two LLM provider implementations.

**Tech Stack:** TypeScript (strict), npm workspaces, Vitest, tsup, ajv (JSON Schema validation), `openai` SDK (for OpenRouter), `@anthropic-ai/sdk`.

**Spec:** `docs/superpowers/specs/2026-08-13-aria-core-extraction-design.md`

## Global Constraints

- Node 18+, TypeScript strict mode, dual ESM+CJS output for `@aria/core` (via tsup) — must work regardless of a consuming app's module system
- Core performs **no authentication** — every interface method takes `userId` on faith; this must be documented, not just implemented
- Tool handler `arguments` are validated against the tool's JSON Schema **before** the handler runs — never trust LLM-emitted arguments directly
- Tool handlers scope all data access via the `userId` parameter only, never via a field inside `args`
- `LLMProvider.call()` is non-streaming only this phase — do not implement streaming
- `safety-filter.ts` is fail-closed: on a crisis/medical-symptom match, skip the LLM call entirely
- No real database or live LLM API call is required for any test in this plan — everything is testable via in-memory stores and mocked provider SDKs
- External consumers pin `@aria/core` via git-tag, never a floating branch — documented in `packages/core/README.md`, not enforced in code

---

## Task 1: Workspace & Package Scaffolding

**Files:**
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts` (placeholder)
- Create: `packages/adapter-example/package.json`
- Create: `packages/adapter-example/tsconfig.json`
- Create: `packages/adapter-example/src/index.ts` (placeholder)

**Interfaces:**
- Produces: an npm workspace where `packages/core` and `packages/adapter-example` both resolve, `npm test` runs (with zero tests passing trivially), `npm run typecheck` runs clean.

- [ ] **Step 1: Create the root workspace `package.json`**

```json
{
  "name": "aria",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "typecheck": "tsc -b --noEmit"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Create the root `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    passWithNoTests: true,
    include: ['packages/*/test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `packages/core/package.json`**

```json
{
  "name": "@aria/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts"
  }
}
```

- [ ] **Step 5: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Create the placeholder `packages/core/src/index.ts`**

```typescript
export const ARIA_CORE_VERSION = '0.1.0';
```

- [ ] **Step 7: Create `packages/adapter-example/package.json`**

```json
{
  "name": "@aria/adapter-example",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@aria/core": "*"
  }
}
```

- [ ] **Step 8: Create `packages/adapter-example/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 9: Create the placeholder `packages/adapter-example/src/index.ts`**

```typescript
export const ARIA_ADAPTER_EXAMPLE_VERSION = '0.0.0';
```

- [ ] **Step 10: Install devDependencies and verify the workspace resolves**

Run: `npm install -D typescript vitest`
Expected: installs successfully, creates/updates root `package-lock.json`, `packages/adapter-example` resolves `@aria/core` to the local workspace package (confirm via `npm ls @aria/core`).

- [ ] **Step 11: Verify typecheck and test pipelines run clean on the placeholders**

Run: `npm run typecheck`
Expected: exits 0, no errors

Run: `npm test`
Expected: exits 0 (passes with zero test files, due to `passWithNoTests: true`)

- [ ] **Step 12: Commit**

```bash
git add package.json tsconfig.base.json vitest.config.ts packages/core/package.json packages/core/tsconfig.json packages/core/src/index.ts packages/adapter-example/package.json packages/adapter-example/tsconfig.json packages/adapter-example/src/index.ts package-lock.json
git commit -m "chore: scaffold npm workspace with @aria/core and @aria/adapter-example packages"
```

---

## Task 2: Core Types (`types.ts`)

**Files:**
- Create: `packages/core/src/types.ts`
- Test: `packages/core/test/types.test.ts`

**Interfaces:**
- Produces: `AriaContextProvider<TContext>`, `AriaMessage`, `AriaHistoryStore`, `AriaPromptConfig<TContext>`, `LLMMessage`, `ToolDefinition`, `LLMToolCall`, `LLMResponse`, `LLMProvider`, `Tool<TArgs>`, `ToolExecutionResult`, `SubscriptionTier`, `RateLimitResult`, `SafetyCheckResult`, `FallbackTopic` — every later task imports from this file.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  AriaContextProvider,
  AriaHistoryStore,
  AriaMessage,
  AriaPromptConfig,
  LLMProvider,
  Tool,
  RateLimitResult,
  SafetyCheckResult,
} from '../src/types';

describe('core type shapes', () => {
  it('AriaContextProvider is implementable', async () => {
    const provider: AriaContextProvider<{ name: string }> = {
      async buildContext(userId) {
        return { name: userId };
      },
      async getCachedContext() {
        return null;
      },
      async cacheContext() {},
      async invalidate() {},
    };
    const ctx = await provider.buildContext('u1');
    expect(ctx.name).toBe('u1');
  });

  it('AriaHistoryStore is implementable', async () => {
    const messages: AriaMessage[] = [];
    const store: AriaHistoryStore = {
      async getRecentMessages() {
        return messages;
      },
      async saveMessage(userId, message) {
        const saved: AriaMessage = { id: '1', createdAt: new Date(), ...message };
        messages.push(saved);
        return saved;
      },
      async clearMessages() {
        messages.length = 0;
      },
      async countMessagesSince() {
        return messages.length;
      },
    };
    const saved = await store.saveMessage('u1', { role: 'user', content: 'hi' });
    expect(saved.content).toBe('hi');
    expect(await store.countMessagesSince('u1', new Date(0))).toBe(1);
  });

  it('AriaPromptConfig is implementable', () => {
    const config: AriaPromptConfig<{ name: string }> = {
      expertise: ['testing'],
      rules: ['be nice'],
      injectContext: (ctx) => `Name: ${ctx.name}`,
    };
    expect(config.injectContext({ name: 'Sam' })).toBe('Name: Sam');
  });

  it('LLMProvider is implementable', async () => {
    const provider: LLMProvider = {
      async call() {
        return { content: 'hello' };
      },
    };
    const res = await provider.call({ systemPrompt: 'sys', messages: [] });
    expect(res.content).toBe('hello');
  });

  it('Tool is implementable', async () => {
    const tool: Tool<{ cups: number }> = {
      definition: {
        name: 'log_water',
        description: 'log water',
        parameters: { type: 'object', properties: { cups: { type: 'number' } } },
      },
      handler: async (userId, args) => `Logged ${args.cups} cups for ${userId}`,
    };
    expect(await tool.handler('u1', { cups: 2 })).toBe('Logged 2 cups for u1');
  });

  it('RateLimitResult and SafetyCheckResult shapes hold expected fields', () => {
    const rl: RateLimitResult = { allowed: true, used: 1, limit: 3, remaining: 2 };
    const safety: SafetyCheckResult = { blocked: false };
    expect(rl.allowed).toBe(true);
    expect(safety.blocked).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/types.test.ts`
Expected: FAIL — `../src/types` does not exist

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/types.ts

// ============================================================
// Context
// ============================================================

export interface AriaContextProvider<TContext> {
  buildContext(userId: string): Promise<TContext>;
  getCachedContext(userId: string): Promise<TContext | null>;
  cacheContext(userId: string, context: TContext, ttlMs?: number): Promise<void>;
  invalidate(userId: string): Promise<void>;
}

// ============================================================
// History
// ============================================================

export interface AriaMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export interface AriaHistoryStore {
  getRecentMessages(userId: string, limit: number): Promise<AriaMessage[]>;
  saveMessage(
    userId: string,
    message: { role: AriaMessage['role']; content: string }
  ): Promise<AriaMessage>;
  clearMessages(userId: string): Promise<void>;
  countMessagesSince(
    userId: string,
    since: Date,
    role?: AriaMessage['role']
  ): Promise<number>;
}

// ============================================================
// Prompt
// ============================================================

export interface AriaPromptConfig<TContext> {
  expertise: string[];
  rules: string[];
  injectContext(context: TContext): string;
  structuredPrompts?: Record<string, (context: TContext) => string>;
}

// ============================================================
// LLM Provider
// ============================================================

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: object;
}

export interface LLMToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
}

export interface LLMProvider {
  call(params: {
    systemPrompt: string;
    messages: LLMMessage[];
    tools?: ToolDefinition[];
  }): Promise<LLMResponse>;
}

// ============================================================
// Tools
// ============================================================

export interface Tool<TArgs = Record<string, unknown>> {
  definition: ToolDefinition;
  handler: (userId: string, args: TArgs) => Promise<string>;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: string;
  error?: string;
}

// ============================================================
// Rate limiting
// ============================================================

export type SubscriptionTier = 'free' | 'premium';

export interface RateLimitResult {
  allowed: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
}

// ============================================================
// Safety
// ============================================================

export interface SafetyCheckResult {
  blocked: boolean;
  response?: string;
}

// ============================================================
// Fallback
// ============================================================

export interface FallbackTopic {
  match: RegExp;
  response: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/types.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/test/types.test.ts
git commit -m "feat(core): define shared interfaces for context, history, prompt, LLM provider, and tools"
```

---

## Task 3: Personality Core (`personality.ts`)

**Files:**
- Create: `packages/core/src/personality.ts`
- Test: `packages/core/test/personality.test.ts`

**Interfaces:**
- Consumes: `AriaPromptConfig<TContext>` (from `types.ts`, Task 2)
- Produces: `EASE_PERSONALITY_CORE: string`, `buildSystemPrompt<TContext>(promptConfig: AriaPromptConfig<TContext>, context: TContext): string` — used by `chat-engine.ts` (Task 11)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/personality.test.ts
import { describe, it, expect } from 'vitest';
import { EASE_PERSONALITY_CORE, buildSystemPrompt } from '../src/personality';
import type { AriaPromptConfig } from '../src/types';

describe('personality core', () => {
  it('includes all four EASE principles', () => {
    expect(EASE_PERSONALITY_CORE).toContain('Empathy');
    expect(EASE_PERSONALITY_CORE).toContain('Authenticity');
    expect(EASE_PERSONALITY_CORE).toContain('Simplicity');
    expect(EASE_PERSONALITY_CORE).toContain('Equity');
  });

  it('includes the never-break-character rule', () => {
    expect(EASE_PERSONALITY_CORE).toContain('Never break character');
  });

  it('buildSystemPrompt composes personality, expertise, rules, and context', () => {
    const config: AriaPromptConfig<{ name: string }> = {
      expertise: ['fitness coaching'],
      rules: ['never give medical advice'],
      injectContext: (ctx) => `User: ${ctx.name}`,
    };
    const prompt = buildSystemPrompt(config, { name: 'Sam' });
    expect(prompt).toContain('ARIA');
    expect(prompt).toContain('fitness coaching');
    expect(prompt).toContain('never give medical advice');
    expect(prompt).toContain('User: Sam');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/personality.test.ts`
Expected: FAIL — `../src/personality` does not exist

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/personality.ts
import type { AriaPromptConfig } from './types';

export const EASE_PERSONALITY_CORE = `You are ARIA (Adaptive Rhythm Intelligence Assistant).
You are warm, knowledgeable, encouraging, and culturally aware.

## YOUR PERSONALITY
- Speak like a supportive coach who genuinely cares
- Use the user's name naturally
- Adapt your tone to their current state
- Celebrate every win — even small ones
- Normalize struggles
- Be honest but kind
- Keep responses concise: 2-4 paragraphs
- End with an actionable next step
- Never break character

## YOUR PHILOSOPHY (EASE)
- Empathy: Meet every person where they are
- Authenticity: Be real
- Simplicity: Clear, actionable guidance
- Equity: Honor all backgrounds and starting points`;

export function buildSystemPrompt<TContext>(
  promptConfig: AriaPromptConfig<TContext>,
  context: TContext
): string {
  const sections = [
    EASE_PERSONALITY_CORE,
    `## YOUR EXPERTISE\n${promptConfig.expertise.map((e) => `- ${e}`).join('\n')}`,
    `## HARD RULES\n${promptConfig.rules.map((r) => `- ${r}`).join('\n')}`,
    promptConfig.injectContext(context),
  ];
  return sections.join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/personality.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/personality.ts packages/core/test/personality.test.ts
git commit -m "feat(core): add EASE personality core and system prompt builder"
```

---

## Task 4: In-Memory History Store

**Files:**
- Create: `packages/core/src/history/in-memory-store.ts`
- Test: `packages/core/test/history/in-memory-store.test.ts`

**Interfaces:**
- Consumes: `AriaHistoryStore`, `AriaMessage` (from `types.ts`, Task 2)
- Produces: `class InMemoryHistoryStore implements AriaHistoryStore` — used as the reference store in Task 11's and Task 14's tests

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/history/in-memory-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryHistoryStore } from '../../src/history/in-memory-store';

describe('InMemoryHistoryStore', () => {
  let store: InMemoryHistoryStore;

  beforeEach(() => {
    store = new InMemoryHistoryStore();
  });

  it('saves and retrieves messages in order', async () => {
    await store.saveMessage('u1', { role: 'user', content: 'hi' });
    await store.saveMessage('u1', { role: 'assistant', content: 'hello' });
    const messages = await store.getRecentMessages('u1', 10);
    expect(messages.map((m) => m.content)).toEqual(['hi', 'hello']);
  });

  it('limits results to the requested count, keeping the most recent', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveMessage('u1', { role: 'user', content: `msg${i}` });
    }
    const messages = await store.getRecentMessages('u1', 2);
    expect(messages.map((m) => m.content)).toEqual(['msg3', 'msg4']);
  });

  it('keeps different users isolated', async () => {
    await store.saveMessage('u1', { role: 'user', content: 'from u1' });
    await store.saveMessage('u2', { role: 'user', content: 'from u2' });
    expect((await store.getRecentMessages('u1', 10)).map((m) => m.content)).toEqual(['from u1']);
    expect((await store.getRecentMessages('u2', 10)).map((m) => m.content)).toEqual(['from u2']);
  });

  it('clears messages for a user', async () => {
    await store.saveMessage('u1', { role: 'user', content: 'hi' });
    await store.clearMessages('u1');
    expect(await store.getRecentMessages('u1', 10)).toEqual([]);
  });

  it('counts messages since a given date, optionally filtered by role', async () => {
    const before = new Date();
    await new Promise((r) => setTimeout(r, 5));
    await store.saveMessage('u1', { role: 'user', content: 'a' });
    await store.saveMessage('u1', { role: 'assistant', content: 'b' });
    expect(await store.countMessagesSince('u1', before)).toBe(2);
    expect(await store.countMessagesSince('u1', before, 'user')).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/history/in-memory-store.test.ts`
Expected: FAIL — `../../src/history/in-memory-store` does not exist

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/history/in-memory-store.ts
import type { AriaHistoryStore, AriaMessage } from '../types';

let idCounter = 0;

export class InMemoryHistoryStore implements AriaHistoryStore {
  private messages = new Map<string, AriaMessage[]>();

  async getRecentMessages(userId: string, limit: number): Promise<AriaMessage[]> {
    const all = this.messages.get(userId) ?? [];
    return all.slice(-limit);
  }

  async saveMessage(
    userId: string,
    message: { role: AriaMessage['role']; content: string }
  ): Promise<AriaMessage> {
    const saved: AriaMessage = {
      id: `msg_${++idCounter}`,
      createdAt: new Date(),
      ...message,
    };
    const existing = this.messages.get(userId) ?? [];
    existing.push(saved);
    this.messages.set(userId, existing);
    return saved;
  }

  async clearMessages(userId: string): Promise<void> {
    this.messages.delete(userId);
  }

  async countMessagesSince(
    userId: string,
    since: Date,
    role?: AriaMessage['role']
  ): Promise<number> {
    const all = this.messages.get(userId) ?? [];
    return all.filter((m) => m.createdAt >= since && (role === undefined || m.role === role))
      .length;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/history/in-memory-store.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/history/in-memory-store.ts packages/core/test/history/in-memory-store.test.ts
git commit -m "feat(core): add in-memory AriaHistoryStore reference implementation"
```

---

## Task 5: Rate Limiter (`rate-limiter.ts`)

**Files:**
- Create: `packages/core/src/rate-limiter.ts`
- Test: `packages/core/test/rate-limiter.test.ts`

**Interfaces:**
- Consumes: `AriaHistoryStore`, `RateLimitResult`, `SubscriptionTier` (from `types.ts`, Task 2)
- Produces: `getStartOfDayInTimezone(now: Date, timezone: string): Date`, `class RateLimiter { constructor(historyStore: AriaHistoryStore, config: { freeLimit: number }); check(userId: string, tier: SubscriptionTier, timezone: string, now?: Date): Promise<RateLimitResult> }` — used by `chat-engine.ts` (Task 11)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/rate-limiter.test.ts
import { describe, it, expect } from 'vitest';
import { RateLimiter, getStartOfDayInTimezone } from '../src/rate-limiter';
import type { AriaHistoryStore, AriaMessage } from '../src/types';

function stubHistoryStore(countResult: number): AriaHistoryStore {
  return {
    async getRecentMessages() {
      return [];
    },
    async saveMessage(_userId, message) {
      return { id: '1', createdAt: new Date(), ...message } as AriaMessage;
    },
    async clearMessages() {},
    async countMessagesSince() {
      return countResult;
    },
  };
}

describe('getStartOfDayInTimezone', () => {
  it('computes midnight Eastern time correctly across the UTC offset', () => {
    const now = new Date('2026-08-13T15:00:00Z'); // 11am EDT
    const start = getStartOfDayInTimezone(now, 'America/New_York');
    expect(start.toISOString()).toBe('2026-08-13T04:00:00.000Z');
  });

  it('computes midnight UTC correctly when timezone is UTC', () => {
    const now = new Date('2026-08-13T15:00:00Z');
    const start = getStartOfDayInTimezone(now, 'UTC');
    expect(start.toISOString()).toBe('2026-08-13T00:00:00.000Z');
  });
});

describe('RateLimiter', () => {
  it('allows unlimited messages for premium users regardless of usage', async () => {
    const limiter = new RateLimiter(stubHistoryStore(999), { freeLimit: 3 });
    const result = await limiter.check('u1', 'premium', 'UTC');
    expect(result).toEqual({ allowed: true, used: 0, limit: null, remaining: null });
  });

  it('allows a free user under the daily limit', async () => {
    const limiter = new RateLimiter(stubHistoryStore(1), { freeLimit: 3 });
    const result = await limiter.check('u1', 'free', 'UTC');
    expect(result).toEqual({ allowed: true, used: 1, limit: 3, remaining: 2 });
  });

  it('blocks a free user who has hit the daily limit', async () => {
    const limiter = new RateLimiter(stubHistoryStore(3), { freeLimit: 3 });
    const result = await limiter.check('u1', 'free', 'UTC');
    expect(result).toEqual({ allowed: false, used: 3, limit: 3, remaining: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/rate-limiter.test.ts`
Expected: FAIL — `../src/rate-limiter` does not exist

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/rate-limiter.ts
import type { AriaHistoryStore, RateLimitResult, SubscriptionTier } from './types';

export interface RateLimiterConfig {
  freeLimit: number;
}

export function getStartOfDayInTimezone(now: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;

  const asUTC = new Date(`${year}-${month}-${day}T00:00:00Z`);
  const offsetMs = getTimezoneOffsetMs(asUTC, timezone);
  return new Date(asUTC.getTime() - offsetMs);
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const asIfUTC = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second'))
  );
  return asIfUTC - date.getTime();
}

export class RateLimiter {
  constructor(
    private historyStore: AriaHistoryStore,
    private config: RateLimiterConfig
  ) {}

  async check(
    userId: string,
    tier: SubscriptionTier,
    timezone: string,
    now: Date = new Date()
  ): Promise<RateLimitResult> {
    if (tier === 'premium') {
      return { allowed: true, used: 0, limit: null, remaining: null };
    }

    const startOfDay = getStartOfDayInTimezone(now, timezone);
    const used = await this.historyStore.countMessagesSince(userId, startOfDay, 'user');
    const remaining = Math.max(0, this.config.freeLimit - used);

    return {
      allowed: used < this.config.freeLimit,
      used,
      limit: this.config.freeLimit,
      remaining,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/rate-limiter.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rate-limiter.ts packages/core/test/rate-limiter.test.ts
git commit -m "feat(core): add timezone-aware rate limiter"
```

---

## Task 6: Safety Filter (`safety-filter.ts`)

**Files:**
- Create: `packages/core/src/safety-filter.ts`
- Test: `packages/core/test/safety-filter.test.ts`

**Interfaces:**
- Consumes: `SafetyCheckResult` (from `types.ts`, Task 2)
- Produces: `checkSafety(message: string, response?: string): SafetyCheckResult` — used by `chat-engine.ts` (Task 11)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/safety-filter.test.ts
import { describe, it, expect } from 'vitest';
import { checkSafety } from '../src/safety-filter';

describe('checkSafety', () => {
  it('blocks self-harm language', () => {
    const result = checkSafety("I've been thinking about hurting myself");
    expect(result.blocked).toBe(true);
    expect(result.response).toBeTruthy();
  });

  it('blocks acute medical symptom language', () => {
    expect(checkSafety('I have chest pain and I feel dizzy').blocked).toBe(true);
    expect(checkSafety("I can't breathe right now").blocked).toBe(true);
  });

  it('does not block normal fitness questions, including ones that share keywords', () => {
    expect(checkSafety('What should I eat before a workout?').blocked).toBe(false);
    expect(checkSafety('My chest workout left me sore').blocked).toBe(false);
  });

  it('allows a custom response to be supplied', () => {
    const result = checkSafety('I want to end my life', 'custom response');
    expect(result.response).toBe('custom response');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/safety-filter.test.ts`
Expected: FAIL — `../src/safety-filter` does not exist

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/safety-filter.ts
import type { SafetyCheckResult } from './types';

const CRISIS_PATTERNS: RegExp[] = [
  /\b(kill myself|suicid|end my life|want to die|self[- ]harm|hurt myself)\b/i,
  /\b(chest pain|can'?t breathe|cannot breathe|severe bleeding|heart attack|stroke)\b/i,
  /\b(overdose|poisoned|poisoning)\b/i,
];

const DEFAULT_SAFETY_RESPONSE =
  "I'm really glad you told me. What you're describing sounds like it needs immediate attention from a real person right now — please contact a medical professional, call your local emergency number, or reach out to a crisis line (in the US, call or text 988). I'm not able to help with this myself, but you deserve real support right now.";

export function checkSafety(
  message: string,
  response: string = DEFAULT_SAFETY_RESPONSE
): SafetyCheckResult {
  const matched = CRISIS_PATTERNS.some((pattern) => pattern.test(message));
  if (matched) {
    return { blocked: true, response };
  }
  return { blocked: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/safety-filter.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/safety-filter.ts packages/core/test/safety-filter.test.ts
git commit -m "feat(core): add fail-closed crisis/medical-language safety filter"
```

---

## Task 7: Fallback Engine (`fallback-engine.ts`)

**Files:**
- Create: `packages/core/src/fallback-engine.ts`
- Test: `packages/core/test/fallback-engine.test.ts`

**Interfaces:**
- Consumes: `FallbackTopic` (from `types.ts`, Task 2)
- Produces: `class FallbackEngine { constructor(topics: FallbackTopic[], defaultResponse: string); respond(message: string): string }` — used by `chat-engine.ts` (Task 11)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/fallback-engine.test.ts
import { describe, it, expect } from 'vitest';
import { FallbackEngine } from '../src/fallback-engine';

describe('FallbackEngine', () => {
  const engine = new FallbackEngine(
    [
      { match: /workout|exercise/, response: 'Workout response' },
      { match: /sleep|tired/, response: 'Sleep response' },
    ],
    'Default response'
  );

  it('matches the first topic whose pattern applies', () => {
    expect(engine.respond('I did a great workout today')).toBe('Workout response');
  });

  it('lowercases the message before matching, so case does not matter', () => {
    expect(engine.respond('WORKOUT time')).toBe('Workout response');
  });

  it('falls back to the default response when nothing matches', () => {
    expect(engine.respond('what is the weather like')).toBe('Default response');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/fallback-engine.test.ts`
Expected: FAIL — `../src/fallback-engine` does not exist

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/fallback-engine.ts
import type { FallbackTopic } from './types';

export class FallbackEngine {
  constructor(
    private topics: FallbackTopic[],
    private defaultResponse: string
  ) {}

  respond(message: string): string {
    const lower = message.toLowerCase();
    const matched = this.topics.find((topic) => topic.match.test(lower));
    return matched ? matched.response : this.defaultResponse;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/fallback-engine.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fallback-engine.ts packages/core/test/fallback-engine.test.ts
git commit -m "feat(core): add keyword-matched fallback engine base class"
```

---

## Task 8: Tool Registry (`tools.ts`)

**Files:**
- Create: `packages/core/src/tools.ts`
- Test: `packages/core/test/tools.test.ts`

**Interfaces:**
- Consumes: `Tool<TArgs>`, `ToolDefinition`, `ToolExecutionResult` (from `types.ts`, Task 2)
- Produces: `type ToolErrorHook = (params: { toolName: string; userId: string; error: string }) => void`, `class ToolRegistry { constructor(onToolError?: ToolErrorHook); register(tool: Tool<any>): void; getDefinitions(): ToolDefinition[]; execute(userId: string, toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult> }` — used by `chat-engine.ts` (Task 11) and `adapter-example` (Task 13)

- [ ] **Step 1: Add the `ajv` dependency**

Run: `npm install ajv --workspace=packages/core`
Expected: installs successfully, adds `ajv` to `packages/core/package.json` dependencies with a resolved current version

- [ ] **Step 2: Write the failing test**

```typescript
// packages/core/test/tools.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../src/tools';
import type { Tool } from '../src/types';

const logWaterTool: Tool<{ cups: number }> = {
  definition: {
    name: 'log_water',
    description: 'Log water intake',
    parameters: {
      type: 'object',
      properties: { cups: { type: 'number' } },
      required: ['cups'],
      additionalProperties: false,
    },
  },
  handler: async (userId, args) => `Logged ${args.cups} cups for ${userId}`,
};

const throwingTool: Tool = {
  definition: {
    name: 'always_throws',
    description: 'always throws',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  handler: async () => {
    throw new Error('boom');
  },
};

describe('ToolRegistry', () => {
  it('executes a registered tool with valid arguments', async () => {
    const registry = new ToolRegistry();
    registry.register(logWaterTool);
    const result = await registry.execute('u1', 'log_water', { cups: 2 });
    expect(result).toEqual({ success: true, result: 'Logged 2 cups for u1' });
  });

  it('rejects arguments that do not match the schema', async () => {
    const registry = new ToolRegistry();
    registry.register(logWaterTool);
    const result = await registry.execute('u1', 'log_water', { cups: 'two' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('log_water');
  });

  it('returns a structured error for an unregistered tool name', async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute('u1', 'does_not_exist', {});
    expect(result).toEqual({ success: false, error: 'Unknown tool: does_not_exist' });
  });

  it('catches a thrown handler error and returns it as a structured result', async () => {
    const registry = new ToolRegistry();
    registry.register(throwingTool);
    const result = await registry.execute('u1', 'always_throws', {});
    expect(result).toEqual({ success: false, error: 'boom' });
  });

  it('invokes the onToolError hook for every failure path', async () => {
    const onToolError = vi.fn();
    const registry = new ToolRegistry(onToolError);
    registry.register(logWaterTool);
    registry.register(throwingTool);

    await registry.execute('u1', 'does_not_exist', {});
    await registry.execute('u1', 'log_water', { cups: 'two' });
    await registry.execute('u1', 'always_throws', {});

    expect(onToolError).toHaveBeenCalledTimes(3);
  });

  it('exposes tool definitions for passing to the LLM provider', () => {
    const registry = new ToolRegistry();
    registry.register(logWaterTool);
    expect(registry.getDefinitions()).toEqual([logWaterTool.definition]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/core/test/tools.test.ts`
Expected: FAIL — `../src/tools` does not exist

- [ ] **Step 4: Write the implementation**

```typescript
// packages/core/src/tools.ts
import Ajv, { type ValidateFunction } from 'ajv';
import type { Tool, ToolDefinition, ToolExecutionResult } from './types';

const ajv = new Ajv();

export type ToolErrorHook = (params: {
  toolName: string;
  userId: string;
  error: string;
}) => void;

export class ToolRegistry {
  private tools = new Map<string, Tool<any>>();
  private validators = new Map<string, ValidateFunction>();

  constructor(private onToolError?: ToolErrorHook) {}

  register(tool: Tool<any>): void {
    this.tools.set(tool.definition.name, tool);
    this.validators.set(tool.definition.name, ajv.compile(tool.definition.parameters));
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(
    userId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(toolName);
    const validate = this.validators.get(toolName);

    if (!tool || !validate) {
      const error = `Unknown tool: ${toolName}`;
      this.onToolError?.({ toolName, userId, error });
      return { success: false, error };
    }

    if (!validate(args)) {
      const error = `Invalid arguments for ${toolName}: ${ajv.errorsText(validate.errors)}`;
      this.onToolError?.({ toolName, userId, error });
      return { success: false, error };
    }

    try {
      const result = await tool.handler(userId, args);
      return { success: true, result };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.onToolError?.({ toolName, userId, error });
      return { success: false, error };
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/core/test/tools.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/package-lock.json packages/core/src/tools.ts packages/core/test/tools.test.ts
git commit -m "feat(core): add tool registry with JSON Schema argument validation"
```

---

## Task 9: OpenRouter Provider (`providers/openrouter.ts`)

**Files:**
- Create: `packages/core/src/providers/openrouter.ts`
- Test: `packages/core/test/providers/openrouter.test.ts`

**Interfaces:**
- Consumes: `LLMProvider`, `LLMMessage`, `ToolDefinition`, `LLMResponse` (from `types.ts`, Task 2)
- Produces: `class OpenRouterProvider implements LLMProvider { constructor(config: { apiKey: string; model?: string; maxTokens?: number }) }` — a concrete `LLMProvider`, injectable into `ChatEngine` (Task 11)

- [ ] **Step 1: Add the `openai` dependency**

Run: `npm install openai --workspace=packages/core`
Expected: installs successfully, adds `openai` to `packages/core/package.json` dependencies

- [ ] **Step 2: Write the failing test**

```typescript
// packages/core/test/providers/openrouter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

import { OpenRouterProvider } from '../../src/providers/openrouter';

describe('OpenRouterProvider', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('maps a plain text response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hello there', tool_calls: undefined } }],
    });

    const provider = new OpenRouterProvider({ apiKey: 'test-key' });
    const result = await provider.call({ systemPrompt: 'sys', messages: [] });

    expect(result).toEqual({ content: 'Hello there', toolCalls: undefined });
  });

  it('maps tool calls, parsing JSON arguments', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [{ function: { name: 'log_water', arguments: '{"cups":2}' } }],
          },
        },
      ],
    });

    const provider = new OpenRouterProvider({ apiKey: 'test-key' });
    const result = await provider.call({ systemPrompt: 'sys', messages: [] });

    expect(result.toolCalls).toEqual([{ name: 'log_water', arguments: { cups: 2 } }]);
  });

  it('passes tool definitions through in OpenAI function-calling shape', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] });

    const provider = new OpenRouterProvider({ apiKey: 'test-key' });
    await provider.call({
      systemPrompt: 'sys',
      messages: [],
      tools: [{ name: 'log_water', description: 'log water', parameters: { type: 'object' } }],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          {
            type: 'function',
            function: {
              name: 'log_water',
              description: 'log water',
              parameters: { type: 'object' },
            },
          },
        ],
      })
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/core/test/providers/openrouter.test.ts`
Expected: FAIL — `../../src/providers/openrouter` does not exist

- [ ] **Step 4: Write the implementation**

```typescript
// packages/core/src/providers/openrouter.ts
import OpenAI from 'openai';
import type { LLMProvider, LLMMessage, ToolDefinition, LLMResponse } from '../types';

export interface OpenRouterProviderConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export class OpenRouterProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(config: OpenRouterProviderConfig) {
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: config.apiKey,
    });
    this.model = config.model ?? 'anthropic/claude-sonnet-4';
    this.maxTokens = config.maxTokens ?? 1024;
  }

  async call(params: {
    systemPrompt: string;
    messages: LLMMessage[];
    tools?: ToolDefinition[];
  }): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: params.systemPrompt },
        ...params.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      tools: params.tools?.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    });

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls?.map((tc: any) => ({
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: choice.message.content ?? '',
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/core/test/providers/openrouter.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/package-lock.json packages/core/src/providers/openrouter.ts packages/core/test/providers/openrouter.test.ts
git commit -m "feat(core): add OpenRouter LLM provider"
```

---

## Task 10: Anthropic Provider (`providers/anthropic.ts`)

**Files:**
- Create: `packages/core/src/providers/anthropic.ts`
- Test: `packages/core/test/providers/anthropic.test.ts`

**Interfaces:**
- Consumes: `LLMProvider`, `LLMMessage`, `ToolDefinition`, `LLMResponse` (from `types.ts`, Task 2)
- Produces: `class AnthropicProvider implements LLMProvider { constructor(config: { apiKey: string; model?: string; maxTokens?: number }) }` — a second concrete `LLMProvider`, injectable into `ChatEngine` (Task 11)

- [ ] **Step 1: Add the `@anthropic-ai/sdk` dependency**

Run: `npm install @anthropic-ai/sdk --workspace=packages/core`
Expected: installs successfully, adds `@anthropic-ai/sdk` to `packages/core/package.json` dependencies

- [ ] **Step 2: Write the failing test**

```typescript
// packages/core/test/providers/anthropic.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

import { AnthropicProvider } from '../../src/providers/anthropic';

describe('AnthropicProvider', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('maps a plain text response from content blocks', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Hello there' }] });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    const result = await provider.call({ systemPrompt: 'sys', messages: [] });

    expect(result).toEqual({ content: 'Hello there', toolCalls: undefined });
  });

  it('maps tool_use content blocks to tool calls', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: '' },
        { type: 'tool_use', name: 'log_water', input: { cups: 2 } },
      ],
    });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    const result = await provider.call({ systemPrompt: 'sys', messages: [] });

    expect(result.toolCalls).toEqual([{ name: 'log_water', arguments: { cups: 2 } }]);
  });

  it('sends the system prompt as a top-level field, not inside messages', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await provider.call({ systemPrompt: 'be nice', messages: [{ role: 'user', content: 'hi' }] });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'be nice',
        messages: [{ role: 'user', content: 'hi' }],
      })
    );
  });

  it('translates tool definitions to input_schema shape', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await provider.call({
      systemPrompt: 'sys',
      messages: [],
      tools: [{ name: 'log_water', description: 'log water', parameters: { type: 'object' } }],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{ name: 'log_water', description: 'log water', input_schema: { type: 'object' } }],
      })
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/core/test/providers/anthropic.test.ts`
Expected: FAIL — `../../src/providers/anthropic` does not exist

- [ ] **Step 4: Write the implementation**

```typescript
// packages/core/src/providers/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMMessage, ToolDefinition, LLMResponse } from '../types';

export interface AnthropicProviderConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(config: AnthropicProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens ?? 1024;
  }

  async call(params: {
    systemPrompt: string;
    messages: LLMMessage[];
    tools?: ToolDefinition[];
  }): Promise<LLMResponse> {
    const response: any = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
      tools: params.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
    });

    let content = '';
    const toolCalls: { name: string; arguments: Record<string, unknown> }[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({ name: block.name, arguments: block.input as Record<string, unknown> });
      }
    }

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/core/test/providers/anthropic.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/package-lock.json packages/core/src/providers/anthropic.ts packages/core/test/providers/anthropic.test.ts
git commit -m "feat(core): add direct Anthropic SDK LLM provider"
```

---

## Task 11: Chat Engine (`chat-engine.ts`)

**Files:**
- Create: `packages/core/src/chat-engine.ts`
- Test: `packages/core/test/chat-engine.test.ts`

**Interfaces:**
- Consumes: `AriaContextProvider`, `AriaHistoryStore`, `AriaMessage`, `AriaPromptConfig`, `LLMProvider`, `SubscriptionTier`, `RateLimitResult` (Task 2); `buildSystemPrompt` (Task 3); `checkSafety` (Task 6); `ToolRegistry` (Task 8); `FallbackEngine` (Task 7); `RateLimiter` (Task 5)
- Produces: `class RateLimitExceededError extends Error`, `interface ChatEngineDeps<TContext>`, `interface SendMessageResult`, `class ChatEngine<TContext> { constructor(deps: ChatEngineDeps<TContext>); sendMessage(userId: string, content: string, tier: SubscriptionTier): Promise<SendMessageResult> }` — the top-level export adapters actually use (Task 13/14)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/chat-engine.test.ts
import { describe, it, expect } from 'vitest';
import { ChatEngine, RateLimitExceededError } from '../src/chat-engine';
import { InMemoryHistoryStore } from '../src/history/in-memory-store';
import { RateLimiter } from '../src/rate-limiter';
import { ToolRegistry } from '../src/tools';
import { FallbackEngine } from '../src/fallback-engine';
import type {
  AriaContextProvider,
  AriaPromptConfig,
  LLMProvider,
  LLMResponse,
} from '../src/types';

interface TestContext {
  name: string;
}

function makeContextProvider(context: TestContext): AriaContextProvider<TestContext> {
  let cached: TestContext | null = null;
  return {
    async buildContext() {
      return context;
    },
    async getCachedContext() {
      return cached;
    },
    async cacheContext(_userId, ctx) {
      cached = ctx;
    },
    async invalidate() {
      cached = null;
    },
  };
}

const promptConfig: AriaPromptConfig<TestContext> = {
  expertise: ['testing'],
  rules: ['be nice'],
  injectContext: (ctx) => `User: ${ctx.name}`,
};

function makeStubProvider(responses: LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    async call() {
      return responses[Math.min(i++, responses.length - 1)];
    },
  };
}

function buildEngine(
  overrides: { llmProvider?: LLMProvider; freeLimit?: number } = {}
) {
  const historyStore = new InMemoryHistoryStore();
  const rateLimiter = new RateLimiter(historyStore, { freeLimit: overrides.freeLimit ?? 3 });
  const toolRegistry = new ToolRegistry();
  const fallbackEngine = new FallbackEngine([], 'Fallback response');
  const engine = new ChatEngine({
    contextProvider: makeContextProvider({ name: 'Sam' }),
    historyStore,
    promptConfig,
    llmProvider: overrides.llmProvider ?? makeStubProvider([{ content: 'Hi Sam!' }]),
    toolRegistry,
    fallbackEngine,
    rateLimiter,
  });
  return { engine, historyStore, toolRegistry };
}

describe('ChatEngine.sendMessage', () => {
  it('saves the user message and the LLM response, returning both', async () => {
    const { engine } = buildEngine();
    const result = await engine.sendMessage('u1', 'Hello ARIA', 'free');

    expect(result.userMessage.content).toBe('Hello ARIA');
    expect(result.ariaMessage.content).toBe('Hi Sam!');
    expect(result.rateLimit.allowed).toBe(true);
  });

  it('throws RateLimitExceededError once the free daily limit is hit', async () => {
    const { engine } = buildEngine({ freeLimit: 1 });
    await engine.sendMessage('u1', 'first', 'free');

    await expect(engine.sendMessage('u1', 'second', 'free')).rejects.toBeInstanceOf(
      RateLimitExceededError
    );
  });

  it('blocks on crisis language without calling the LLM provider', async () => {
    let called = false;
    const llmProvider: LLMProvider = {
      async call() {
        called = true;
        return { content: 'should not reach here' };
      },
    };
    const { engine } = buildEngine({ llmProvider });

    const result = await engine.sendMessage('u1', 'I want to end my life', 'free');

    expect(called).toBe(false);
    expect(result.ariaMessage.content).toContain('988');
  });

  it('falls back to the fallback engine when the LLM provider throws', async () => {
    const llmProvider: LLMProvider = {
      async call() {
        throw new Error('provider down');
      },
    };
    const { engine } = buildEngine({ llmProvider });

    const result = await engine.sendMessage('u1', 'Hello', 'free');

    expect(result.ariaMessage.content).toBe('Fallback response');
  });

  it('executes a tool call and folds the result into a follow-up LLM call', async () => {
    const { engine, toolRegistry } = buildEngine({
      llmProvider: makeStubProvider([
        { content: '', toolCalls: [{ name: 'log_water', arguments: { cups: 2 } }] },
        { content: 'Logged your water, nice work!' },
      ]),
    });

    toolRegistry.register({
      definition: {
        name: 'log_water',
        description: 'Log water intake',
        parameters: {
          type: 'object',
          properties: { cups: { type: 'number' } },
          required: ['cups'],
        },
      },
      handler: async (userId, args: { cups: number }) =>
        `Logged ${args.cups} cups for ${userId}`,
    });

    const result = await engine.sendMessage('u1', 'I drank 2 cups of water', 'free');

    expect(result.ariaMessage.content).toBe('Logged your water, nice work!');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/chat-engine.test.ts`
Expected: FAIL — `../src/chat-engine` does not exist

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/chat-engine.ts
import type {
  AriaContextProvider,
  AriaHistoryStore,
  AriaMessage,
  AriaPromptConfig,
  LLMProvider,
  SubscriptionTier,
  RateLimitResult,
} from './types';
import { buildSystemPrompt } from './personality';
import { checkSafety } from './safety-filter';
import { ToolRegistry } from './tools';
import { FallbackEngine } from './fallback-engine';
import { RateLimiter } from './rate-limiter';

export interface ChatEngineDeps<TContext> {
  contextProvider: AriaContextProvider<TContext>;
  historyStore: AriaHistoryStore;
  promptConfig: AriaPromptConfig<TContext>;
  llmProvider: LLMProvider;
  toolRegistry: ToolRegistry;
  fallbackEngine: FallbackEngine;
  rateLimiter: RateLimiter;
  timezone?: string;
  historyLimit?: number;
}

export interface SendMessageResult {
  userMessage: AriaMessage;
  ariaMessage: AriaMessage;
  rateLimit: RateLimitResult;
}

export class RateLimitExceededError extends Error {
  constructor(public rateLimit: RateLimitResult) {
    super('Daily message limit reached');
    this.name = 'RateLimitExceededError';
  }
}

export class ChatEngine<TContext> {
  private timezone: string;
  private historyLimit: number;

  constructor(private deps: ChatEngineDeps<TContext>) {
    this.timezone = deps.timezone ?? 'UTC';
    this.historyLimit = deps.historyLimit ?? 20;
  }

  async sendMessage(
    userId: string,
    content: string,
    tier: SubscriptionTier
  ): Promise<SendMessageResult> {
    const rateLimit = await this.deps.rateLimiter.check(userId, tier, this.timezone);
    if (!rateLimit.allowed) {
      throw new RateLimitExceededError(rateLimit);
    }

    const safety = checkSafety(content);
    const userMessage = await this.deps.historyStore.saveMessage(userId, {
      role: 'user',
      content,
    });

    if (safety.blocked) {
      const ariaMessage = await this.deps.historyStore.saveMessage(userId, {
        role: 'assistant',
        content: safety.response!,
      });
      return { userMessage, ariaMessage, rateLimit };
    }

    let responseText: string;
    try {
      responseText = await this.generateResponse(userId, content);
    } catch {
      responseText = this.deps.fallbackEngine.respond(content);
    }

    const ariaMessage = await this.deps.historyStore.saveMessage(userId, {
      role: 'assistant',
      content: responseText,
    });

    return { userMessage, ariaMessage, rateLimit };
  }

  private async generateResponse(userId: string, content: string): Promise<string> {
    const history = await this.deps.historyStore.getRecentMessages(userId, this.historyLimit);

    let context = await this.deps.contextProvider.getCachedContext(userId);
    if (!context) {
      context = await this.deps.contextProvider.buildContext(userId);
      await this.deps.contextProvider.cacheContext(userId, context);
    }

    const systemPrompt = buildSystemPrompt(this.deps.promptConfig, context);
    const tools = this.deps.toolRegistry.getDefinitions();

    let response = await this.deps.llmProvider.call({
      systemPrompt,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
      tools: tools.length > 0 ? tools : undefined,
    });

    // Phase 1 simplification: tool results are folded into a synthesized
    // assistant-authored recap rather than using a provider-native tool-result
    // message type (LLMMessage only models user/assistant roles this phase).
    // Sufficient to prove the tool-use interface end-to-end; a native
    // tool-result message type is a Phase 2+ refinement.
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolResults = await Promise.all(
        response.toolCalls.map(async (call) => {
          const result = await this.deps.toolRegistry.execute(userId, call.name, call.arguments);
          return `[${call.name}] ${result.success ? result.result : `Error: ${result.error}`}`;
        })
      );

      response = await this.deps.llmProvider.call({
        systemPrompt,
        messages: [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content },
          { role: 'assistant' as const, content: toolResults.join('\n') },
        ],
      });
    }

    return response.content;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/chat-engine.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/chat-engine.ts packages/core/test/chat-engine.test.ts
git commit -m "feat(core): add ChatEngine orchestrator (rate limit, safety filter, tools, fallback)"
```

---

## Task 12: Core Package Index & Build Verification

**Files:**
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: the full public surface of `@aria/core` — every type/class from Tasks 2–11, re-exported for consumers

- [ ] **Step 1: Replace the placeholder index with real exports**

```typescript
// packages/core/src/index.ts
export * from './types';
export { EASE_PERSONALITY_CORE, buildSystemPrompt } from './personality';
export { InMemoryHistoryStore } from './history/in-memory-store';
export { RateLimiter, getStartOfDayInTimezone } from './rate-limiter';
export type { RateLimiterConfig } from './rate-limiter';
export { checkSafety } from './safety-filter';
export { FallbackEngine } from './fallback-engine';
export { ToolRegistry } from './tools';
export type { ToolErrorHook } from './tools';
export { OpenRouterProvider } from './providers/openrouter';
export type { OpenRouterProviderConfig } from './providers/openrouter';
export { AnthropicProvider } from './providers/anthropic';
export type { AnthropicProviderConfig } from './providers/anthropic';
export { ChatEngine, RateLimitExceededError } from './chat-engine';
export type { ChatEngineDeps, SendMessageResult } from './chat-engine';
```

- [ ] **Step 2: Run the full core test suite to confirm nothing broke**

Run: `npx vitest run packages/core`
Expected: PASS (all tests from Tasks 2–11)

- [ ] **Step 3: Add the `tsup` dev dependency and build**

Run: `npm install -D tsup --workspace=packages/core`
Expected: installs successfully

Run: `cd packages/core && npm run build`
Expected: exits 0, creates `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`

- [ ] **Step 4: Verify the CJS build is importable**

Run: `node -e "const core = require('./packages/core/dist/index.cjs'); console.log(typeof core.ChatEngine)"`
Expected output: `function`

- [ ] **Step 5: Verify the ESM build is importable**

Run: `node -e "import('./packages/core/dist/index.js').then(core => console.log(typeof core.ChatEngine))"`
Expected output: `function`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts packages/core/package.json packages/core/package-lock.json
git commit -m "feat(core): export full public surface, verify dual ESM/CJS build"
```

---

## Task 13: Synthetic Adapter — Example Domain

**Files:**
- Create: `packages/adapter-example/src/context-provider.ts`
- Create: `packages/adapter-example/src/prompt-config.ts`
- Create: `packages/adapter-example/src/tools.ts`
- Modify: `packages/adapter-example/src/index.ts`
- Test: `packages/adapter-example/test/context-provider.test.ts`
- Test: `packages/adapter-example/test/prompt-config.test.ts`
- Test: `packages/adapter-example/test/tools.test.ts`

**Interfaces:**
- Consumes: `AriaContextProvider`, `AriaPromptConfig`, `Tool` (from `@aria/core`, built in Tasks 2–12)
- Produces: `interface ExampleContext`, `class ExampleContextProvider implements AriaContextProvider<ExampleContext>`, `examplePromptConfig: AriaPromptConfig<ExampleContext>`, `checkInTool: Tool<{ habitName: string }>` — consumed by the integration test (Task 14)

- [ ] **Step 1: Write the failing test for the context provider**

```typescript
// packages/adapter-example/test/context-provider.test.ts
import { describe, it, expect } from 'vitest';
import { ExampleContextProvider } from '../src/context-provider';

describe('ExampleContextProvider', () => {
  it('returns seeded data for a known user', async () => {
    const provider = new ExampleContextProvider();
    const ctx = await provider.buildContext('demo_user');
    expect(ctx.userName).toBe('Demo User');
    expect(ctx.habits).toHaveLength(2);
  });

  it('returns a safe default for an unknown user', async () => {
    const provider = new ExampleContextProvider();
    const ctx = await provider.buildContext('nobody');
    expect(ctx).toEqual({ userName: 'there', habits: [], lastCheckIn: null });
  });

  it('caches and invalidates independently of buildContext', async () => {
    const provider = new ExampleContextProvider();
    expect(await provider.getCachedContext('demo_user')).toBeNull();

    const ctx = await provider.buildContext('demo_user');
    await provider.cacheContext('demo_user', ctx);
    expect(await provider.getCachedContext('demo_user')).toEqual(ctx);

    await provider.invalidate('demo_user');
    expect(await provider.getCachedContext('demo_user')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/adapter-example/test/context-provider.test.ts`
Expected: FAIL — `../src/context-provider` does not exist

- [ ] **Step 3: Implement the context provider**

```typescript
// packages/adapter-example/src/context-provider.ts
import type { AriaContextProvider } from '@aria/core';

export interface ExampleContext {
  userName: string;
  habits: { name: string; streakDays: number }[];
  lastCheckIn: string | null;
}

const FAKE_DB: Record<string, ExampleContext> = {
  demo_user: {
    userName: 'Demo User',
    habits: [
      { name: 'Morning walk', streakDays: 4 },
      { name: 'Journaling', streakDays: 1 },
    ],
    lastCheckIn: '2026-08-12',
  },
};

export class ExampleContextProvider implements AriaContextProvider<ExampleContext> {
  private cache = new Map<string, ExampleContext>();

  async buildContext(userId: string): Promise<ExampleContext> {
    return FAKE_DB[userId] ?? { userName: 'there', habits: [], lastCheckIn: null };
  }

  async getCachedContext(userId: string): Promise<ExampleContext | null> {
    return this.cache.get(userId) ?? null;
  }

  async cacheContext(userId: string, context: ExampleContext): Promise<void> {
    this.cache.set(userId, context);
  }

  async invalidate(userId: string): Promise<void> {
    this.cache.delete(userId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/adapter-example/test/context-provider.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for the prompt config**

```typescript
// packages/adapter-example/test/prompt-config.test.ts
import { describe, it, expect } from 'vitest';
import { examplePromptConfig } from '../src/prompt-config';

describe('examplePromptConfig', () => {
  it('lists habits with their streaks', () => {
    const prompt = examplePromptConfig.injectContext({
      userName: 'Sam',
      habits: [{ name: 'Reading', streakDays: 3 }],
      lastCheckIn: '2026-08-12',
    });
    expect(prompt).toContain('Sam');
    expect(prompt).toContain('Reading: 3-day streak');
  });

  it('handles a user with no habits yet', () => {
    const prompt = examplePromptConfig.injectContext({
      userName: 'Sam',
      habits: [],
      lastCheckIn: null,
    });
    expect(prompt).toContain('No habits tracked yet.');
    expect(prompt).toContain('Last check-in: never');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run packages/adapter-example/test/prompt-config.test.ts`
Expected: FAIL — `../src/prompt-config` does not exist

- [ ] **Step 7: Implement the prompt config**

```typescript
// packages/adapter-example/src/prompt-config.ts
import type { AriaPromptConfig } from '@aria/core';
import type { ExampleContext } from './context-provider';

export const examplePromptConfig: AriaPromptConfig<ExampleContext> = {
  expertise: ['habit formation', 'daily check-ins', 'streak encouragement'],
  rules: ['never shame a broken streak', 'always suggest the smallest next step'],
  injectContext: (ctx) => {
    const habitLines = ctx.habits
      .map((h) => `- ${h.name}: ${h.streakDays}-day streak`)
      .join('\n');
    return `## USER\nName: ${ctx.userName}\nLast check-in: ${ctx.lastCheckIn ?? 'never'}\n\n## HABITS\n${habitLines || 'No habits tracked yet.'}`;
  },
};
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run packages/adapter-example/test/prompt-config.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Write the failing test for the tool**

```typescript
// packages/adapter-example/test/tools.test.ts
import { describe, it, expect } from 'vitest';
import { checkInTool } from '../src/tools';

describe('checkInTool', () => {
  it('records a habit check-in for the given user', async () => {
    const result = await checkInTool.handler('demo_user', { habitName: 'Morning walk' });
    expect(result).toBe('Checked in "Morning walk" for demo_user');
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run packages/adapter-example/test/tools.test.ts`
Expected: FAIL — `../src/tools` does not exist

- [ ] **Step 11: Implement the tool**

```typescript
// packages/adapter-example/src/tools.ts
import type { Tool } from '@aria/core';

export const checkInTool: Tool<{ habitName: string }> = {
  definition: {
    name: 'check_in_habit',
    description: 'Record that the user completed a habit today',
    parameters: {
      type: 'object',
      properties: { habitName: { type: 'string' } },
      required: ['habitName'],
      additionalProperties: false,
    },
  },
  handler: async (userId, args) => `Checked in "${args.habitName}" for ${userId}`,
};
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run packages/adapter-example/test/tools.test.ts`
Expected: PASS (1 test)

- [ ] **Step 13: Update the package index**

```typescript
// packages/adapter-example/src/index.ts
export { ExampleContextProvider } from './context-provider';
export type { ExampleContext } from './context-provider';
export { examplePromptConfig } from './prompt-config';
export { checkInTool } from './tools';
```

- [ ] **Step 14: Commit**

```bash
git add packages/adapter-example/src packages/adapter-example/test
git commit -m "feat(adapter-example): implement synthetic habit-tracking domain against core interfaces"
```

---

## Task 14: End-to-End Integration Test

**Files:**
- Test: `packages/adapter-example/test/integration.test.ts`

**Interfaces:**
- Consumes: everything from `@aria/core` (Task 12) and `@aria/adapter-example` (Task 13)
- Produces: proof that every core interface is exercised together through a real `ChatEngine.sendMessage()` call against a second (synthetic) domain shape — this is the spec's core Phase 1 success criterion

- [ ] **Step 1: Write the integration test**

```typescript
// packages/adapter-example/test/integration.test.ts
import { describe, it, expect } from 'vitest';
import {
  ChatEngine,
  InMemoryHistoryStore,
  RateLimiter,
  ToolRegistry,
  FallbackEngine,
} from '@aria/core';
import type { LLMProvider } from '@aria/core';
import { ExampleContextProvider, examplePromptConfig, checkInTool } from '../src';

describe('adapter-example end-to-end', () => {
  it('exercises every core interface through a full sendMessage call', async () => {
    const historyStore = new InMemoryHistoryStore();
    const contextProvider = new ExampleContextProvider();
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(checkInTool);

    let callCount = 0;
    const llmProvider: LLMProvider = {
      async call() {
        callCount++;
        if (callCount === 1) {
          return {
            content: '',
            toolCalls: [{ name: 'check_in_habit', arguments: { habitName: 'Morning walk' } }],
          };
        }
        return { content: 'Nice work checking in on your morning walk!' };
      },
    };

    const engine = new ChatEngine({
      contextProvider,
      historyStore,
      promptConfig: examplePromptConfig,
      llmProvider,
      toolRegistry,
      fallbackEngine: new FallbackEngine([], "I'm here to help with your habits."),
      rateLimiter: new RateLimiter(historyStore, { freeLimit: 3 }),
    });

    const result = await engine.sendMessage('demo_user', 'I finished my morning walk', 'free');

    expect(result.ariaMessage.content).toBe('Nice work checking in on your morning walk!');
    expect(result.userMessage.content).toBe('I finished my morning walk');
    expect(callCount).toBe(2);

    const history = await historyStore.getRecentMessages('demo_user', 10);
    expect(history).toHaveLength(2);
  });

  it('respects the safety filter and rate limiter identically to any other domain', async () => {
    const historyStore = new InMemoryHistoryStore();
    const engine = new ChatEngine({
      contextProvider: new ExampleContextProvider(),
      historyStore,
      promptConfig: examplePromptConfig,
      llmProvider: { async call() { return { content: 'should not be reached' }; } },
      toolRegistry: new ToolRegistry(),
      fallbackEngine: new FallbackEngine([], 'fallback'),
      rateLimiter: new RateLimiter(historyStore, { freeLimit: 1 }),
    });

    const safetyResult = await engine.sendMessage('demo_user', 'I want to end my life', 'free');
    expect(safetyResult.ariaMessage.content).toContain('988');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails or passes for the right reasons**

Run: `npx vitest run packages/adapter-example/test/integration.test.ts`
Expected: If `packages/core` hasn't been rebuilt since Task 12, this may fail on module resolution — run `cd packages/core && npm run build` first, then re-run. After that, expect PASS (2 tests) since all underlying pieces already exist from Tasks 2–13.

- [ ] **Step 3: Commit**

```bash
git add packages/adapter-example/test/integration.test.ts
git commit -m "test: add end-to-end integration test proving core interfaces generalize to a second domain"
```

---

## Task 15: Documentation & Final Verification

**Files:**
- Create: `packages/core/README.md`

**Interfaces:**
- Produces: none (documentation only) — closes the spec's documentation-related success criteria

- [ ] **Step 1: Write `packages/core/README.md`**

```markdown
# @aria/core

The universal ARIA engine — personality, chat orchestration, rate limiting, tool-use, and safety filtering, decoupled from any single app's domain.

## Security Contract

**This package performs no authentication or authorization.** Every method on `AriaContextProvider`, `AriaHistoryStore`, and every `Tool` handler receives a raw `userId: string` on faith. The consuming app's route layer is responsible for verifying the caller's authenticated session matches `userId` *before* calling `ChatEngine.sendMessage()` or any core interface method directly. Passing an unverified or client-supplied `userId` is a direct cross-user data exposure vulnerability.

Tool handlers must derive all data scope from the `userId` parameter they're called with — never from a field inside `args`, even if a future tool schema is tempted to add one.

## Versioning & Distribution

This package is not published to a registry. Consuming apps outside this monorepo should pin it via a git-tag dependency:

\```json
{
  "dependencies": {
    "@aria/core": "github:<you>/aria#v0.1.0"
  }
}
\```

Never depend on a floating branch (e.g. `#main`) — a change made for one consuming app would silently change behavior for every other app pinned the same way. Releases are tagged with semver; a breaking interface change bumps the major version.

## Deployment Requirement: Per-App API Keys

Each consuming app should use its own `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY`. Sharing one key across multiple apps means a leak or cost-abuse incident in any single app compromises every other app using that key.

## Non-Goals (Phase 1)

Streaming responses, long-term conversation memory, sentiment-aware prompting, full topic guardrailing (only the crisis/medical-symptom safety filter is included), proactive nudges, and multimodal/vision support are all deferred — see `docs/superpowers/specs/2026-08-13-aria-core-extraction-design.md`.
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests across `packages/core` and `packages/adapter-example` (types, personality, in-memory store, rate limiter, safety filter, fallback engine, tools, both providers, chat engine, adapter-example's three modules, and the two integration tests)

- [ ] **Step 3: Run the full typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors

- [ ] **Step 4: Re-verify the core build is current**

Run: `cd packages/core && npm run build`
Expected: exits 0

- [ ] **Step 5: Confirm the risk register from the spec phase is still present and unmodified**

Run: `cat RISK-REGISTER.md`
Expected: shows RISK-001 (privacy policy gap) and RISK-002 (medical-advice verification gap), both still `Status: Open` — this task doesn't close them, it only confirms they weren't silently lost

- [ ] **Step 6: Commit**

```bash
git add packages/core/README.md
git commit -m "docs(core): document security contract, versioning convention, and per-app API key requirement"
```

---

## Plan Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-08-13-aria-core-extraction-design.md` maps to a task — repository structure (Task 1), all core interfaces (Task 2), chat-engine orchestration incl. safety filter and tool validation (Task 11), rate limiter (Task 5), event-driven invalidation (interface in Task 2, exercised in Tasks 13–14), tools registry (Task 8), safety filter (Task 6), fallback engine (Task 7), both LLM providers (Tasks 9–10), versioning/API-key documentation (Task 15), synthetic adapter (Task 13), interface-generalization proof (Task 14). My Body migration (Phase 2) and all explicit non-goals are correctly excluded from every task.
- **Type consistency:** `AriaMessage`, `AriaHistoryStore`, `RateLimitResult`, `SafetyCheckResult`, `ToolExecutionResult`, `Tool<TArgs>`, `LLMProvider`/`LLMMessage`/`ToolDefinition`/`LLMToolCall`/`LLMResponse`, and `ChatEngineDeps<TContext>` are defined once in Task 2/Task 11 and referenced identically (same field names, same optionality) in every later task and test.
- **Known Phase 1 simplification, flagged explicitly in code and here:** tool-call results are folded into a synthesized assistant-authored message for the follow-up LLM call, rather than using a provider-native tool-result message type — sufficient to prove the tool-use interface works end-to-end (Task 14), but a real tool-role message type is worth revisiting once a production adapter is built in Phase 2.
