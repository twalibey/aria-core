# ARIA Core Extraction — Design Spec

**Date:** 2026-08-13
**Status:** Approved, pending final user review of this file
**Source material:** `ARIA-Reference.md` (existing 2000+ line reference doc for the ARIA pattern as implemented in the My Body fitness app)

## What This Is

Extract ARIA — currently ~1,400 lines of TypeScript living inside the My Body fitness app — into a standalone, provider-agnostic package (`@aria/core`) that any future app can adopt via a thin domain-specific adapter, per the "Making ARIA Cross-Project" blueprint already documented in `ARIA-Reference.md`.

This spec covers **Phase 1 only**: the core engine, its interfaces, and one synthetic adapter built purely to validate those interfaces. It does **not** cover extracting My Body's real fitness logic (that's Phase 2, named below) or any of the roadmap's deeper enhancements (streaming, long-term memory, sentiment, nudges, vision — all explicitly deferred).

## Why a Synthetic Adapter, Not "Interfaces Only"

The original plan was core + interfaces with no adapter at all. A red-team pass on that plan found the load-bearing flaw directly: interfaces designed against a sample size of one domain (fitness) plus imagination of others is not a validated abstraction — it's fitness-shaped code wearing generic type parameters, and it would ship with zero feedback on whether it actually generalizes. The fix folded into this design: build one throwaway synthetic adapter (fake domain, in-memory mock data, never shipped) whose only job is exercising every core interface once before anything is locked in.

## Repository Structure

```
ARIA/
├── package.json                    # npm workspace root
├── tsconfig.base.json
├── vitest.config.ts
├── packages/
│   ├── core/                       # @aria/core
│   │   ├── src/
│   │   │   ├── types.ts            # all shared interfaces (below)
│   │   │   ├── personality.ts      # EASE philosophy, shared tone rules
│   │   │   ├── chat-engine.ts      # orchestration
│   │   │   ├── rate-limiter.ts     # tier-based, timezone-aware
│   │   │   ├── fallback-engine.ts  # base class for keyword fallback
│   │   │   ├── tools.ts            # tool registry + executor
│   │   │   ├── history/
│   │   │   │   └── in-memory-store.ts   # reference AriaHistoryStore impl
│   │   │   ├── providers/
│   │   │   │   ├── openrouter.ts   # default LLM provider
│   │   │   │   └── anthropic.ts    # secondary LLM provider
│   │   │   └── index.ts
│   │   ├── package.json            # dual ESM+CJS build via tsup
│   │   └── tsconfig.json
│   └── adapter-example/            # synthetic, throwaway — validation only
│       ├── src/
│       │   ├── context-provider.ts # fake domain, in-memory mock data
│       │   ├── prompt-config.ts
│       │   ├── tools.ts
│       │   └── index.ts
│       └── package.json
├── docs/superpowers/specs/         # this file lives here
└── ARIA-Reference.md               # stays as source reference, unmodified
```

Package manager: npm workspaces. Build target: dual ESM+CJS output via `tsup`, Node 18+ — chosen specifically so `@aria/core` works regardless of what module system any given consuming app uses, without needing to know that in advance. Test framework: Vitest.

## Core Interfaces (`types.ts`)

```typescript
interface AriaContextProvider<TContext> {
  buildContext(userId: string): Promise<TContext>;
  getCachedContext(userId: string): Promise<TContext | null>;
  cacheContext(userId: string, context: TContext, ttlMs?: number): Promise<void>;
  invalidate(userId: string): Promise<void>;
  // Called by the CONSUMING APP's own routes when user data changes
  // (e.g. after a workout is logged). Core never calls this itself —
  // only the adapter/app layer knows when its data changed.
}

interface AriaHistoryStore<TMessage> {
  getRecentMessages(userId: string, limit: number): Promise<TMessage[]>;
  saveMessage(userId: string, message: TMessage): Promise<TMessage>;
  clearMessages(userId: string): Promise<void>;
  countMessagesSince(userId: string, since: Date, role?: string): Promise<number>;
  // Added during self-review: rate-limiter needs this to count today's
  // user messages; the original get/save/clear trio couldn't support it.
}

interface AriaPromptConfig<TContext> {
  expertise: string[];
  rules: string[];
  injectContext(context: TContext): string;
  structuredPrompts?: Record<string, (context: TContext) => string>;
}

interface LLMProvider {
  // Non-streaming only this phase — streaming is an explicit non-goal (see below).
  call(params: {
    systemPrompt: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    tools?: ToolDefinition[];
  }): Promise<{
    content: string;
    toolCalls?: { name: string; arguments: Record<string, unknown> }[];
  }>;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: object; // JSON Schema
}

interface Tool<TArgs = any> {
  definition: ToolDefinition;
  handler: (userId: string, args: TArgs) => Promise<string>;
}
```

`LLMProvider` is deliberately shaped like OpenAI-style function-calling (OpenRouter is already OpenAI-compatible). Provider-specific translation — including Anthropic SDK's differing tool-call format — lives entirely inside `providers/openrouter.ts` and `providers/anthropic.ts`. Core logic never sees provider-specific quirks; this is what prevents the abstraction from leaking.

## `chat-engine.ts` — Orchestration

1. Rate limit check (via `rate-limiter.ts`, which calls `AriaHistoryStore.countMessagesSince`)
2. Save user message (`AriaHistoryStore.saveMessage`)
3. Load recent history (`AriaHistoryStore.getRecentMessages`)
4. Get or rebuild context (`AriaContextProvider.getCachedContext` / `buildContext`)
5. Build system prompt (`AriaPromptConfig.injectContext` + personality core)
6. Call LLM (`LLMProvider.call`, with registered tools passed through)
7. If the response includes tool calls: execute each via `ToolRegistry`, wrapped in try/catch. A thrown error or an unregistered tool name both produce a structured error result fed back to the LLM (so it can respond gracefully) rather than crashing the request. Failures route through an injectable `onToolError` hook for future observability.
8. On LLM/provider failure at any point: degrade to `fallback-engine.ts`, never leave the user without a response.
9. Save ARIA's response (`AriaHistoryStore.saveMessage`)

## `rate-limiter.ts`

Tier-based daily limits (free/premium), timezone-aware from day one — this closes roadmap gap #3 as a structural property of core rather than a later patch. Uses `AriaHistoryStore.countMessagesSince` with the user's local midnight, not server UTC midnight.

## Event-Driven Context Invalidation

Roadmap gap #1 (event-driven context invalidation) is brought into core alongside tool-use and timezone rate limiting, so all three of the reference doc's "Critical" items are handled consistently in this phase — the earlier draft only pulled two of three, which the gap analysis flagged as an inconsistent cut. `AriaContextProvider.invalidate(userId)` is the mechanism; each adapter's own app routes call it after writes relevant to their domain (core defines and honors the interface, never calls it itself, since only the app knows when its data changed).

## `tools.ts` — Tool Registry

Generic registration/execution framework, closing roadmap gap #2. Each adapter (synthetic now, real domains later) registers its own tools with `name` + `description` + JSON-schema `parameters` + `handler` — the same shape this very Claude Code skill library uses for its own skills. Tools are registered independently of `AriaPromptConfig`, not folded into it, so prompt construction and tool availability stay separately testable.

## `fallback-engine.ts`

Base class for keyword-matched fallback responses (used when the LLM provider fails or no API key is configured). Each adapter overrides with its own domain-specific keyword responses.

## Versioning & Distribution

- **Within this repo:** `adapter-example` (and any future real adapters, if ever colocated here) consume `@aria/core` via the npm workspace protocol — always in sync, single source of truth.
- **External consumers** (separate app repos — My Body and whatever comes next): pin `@aria/core` via a **git-tag dependency** (`"@aria/core": "github:<you>/aria#v0.1.0"`), never a floating branch. The core repo tags releases with semver; a breaking interface change bumps major. This directly closes the operational gap where "several apps, fairly soon" combined with unpinned relative imports would have let a change for app #2 silently break app #1's production code.

## My Body Migration — Phase 2 (named, tracked, not built this phase)

My Body's current inline ARIA implementation keeps running unmodified until a real `adapter-fitness` package is built and validated against `@aria/core`. Only then does My Body swap its internal `aria-*.ts` files for the package + adapter, behind a feature flag, with the old inline code deleted only after confirmed parity. This is called out explicitly so it doesn't become silent, indefinite debt — it's the natural next spec after this one.

## Explicit Non-Goals This Phase

Streaming responses, long-term conversation memory/summarization, sentiment-aware prompting, topic guardrailing, proactive nudges, multimodal/vision support. All are real items from the reference doc's roadmap; all require a real (non-synthetic) adapter in production to validate against, which this phase deliberately doesn't have.

## Success Criteria

- `@aria/core` scaffolded; dual ESM/CJS build compiles clean
- All interfaces above (`AriaContextProvider` incl. invalidation, `AriaHistoryStore` incl. `countMessagesSince`, `AriaPromptConfig`, `LLMProvider`, `Tool`/`ToolRegistry`) defined and implemented
- `adapter-example` implements every core interface once, proving they're exercisable by a second (synthetic) domain shape — not just internally consistent on paper
- Unit tests (Vitest) pass against the in-memory history store and synthetic adapter; no real database or live LLM call required
- Versioning convention (git-tag pinning) documented in `packages/core/README.md`
- My Body migration path named as Phase 2 in this spec, not built
- This design doc written, self-reviewed, and handed to the `writing-plans` skill for the implementation plan
