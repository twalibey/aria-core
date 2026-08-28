# `@aria/adapter-fitness` — Design Spec

**Date:** 2026-08-28
**Status:** Draft, pending user review of this file
**Source material:** `ARIA-Reference.md` (rewritten 2026-08-21 against real My Body source), the 12 real My Body files in `.reference/my-body-source/` (re-read directly during this design pass, not just the doc's paraphrase — see Verification Note below), `packages/core/` as it exists after Phase 1

## What This Is

Phase 1 (`docs/superpowers/specs/2026-08-13-aria-core-extraction-design.md`) built `@aria/core` and validated its interfaces with a synthetic adapter (`@aria/adapter-example`). This phase does two things:

1. Resolves the categorization question Phase 1's rewritten `ARIA-Reference.md` deliberately left open: whether tool-calling, topic guardrails, sentiment detection, and long-term memory belong in universal `@aria/core` or in a fitness-specific adapter. **Decision (made 2026-08-28, recorded in `ARIA-Reference.md`): mechanism in core, content in adapter, for all four.**
2. Builds `@aria/adapter-fitness` — a **standalone proof, not a live migration target**. It proves the split works by faithfully reproducing real My Body behavior (real tool set, real guardrail categories, real sentiment patterns, real memory extraction prompt) against **injected/mocked context data**, the same way `@aria/adapter-example` proved Phase 1's interfaces against a synthetic domain. Wiring this into My Body's actual Postgres/Supabase tables is explicitly a separate, later effort.

**Out of scope for this phase:** the Weekly Wellness Plan system, the exercise-modification safety subsystem, and sport periodization. These are separate product surfaces beyond core ARIA chat (see `ARIA-Reference.md`'s "Weekly Wellness Plan System" and "Exercise Modification & Safety" sections) and are not touched here.

**Also out of scope:** any CorpFlow-related work. A separate, much larger decision was made during this same design session — CorpFlow (a completely different, already-built application) will become a second real adapter (`@aria/adapter-corpflow`), requiring a new code-level tenant-scoping layer in core. That is its own architectural-scale project needing its own dedicated brainstorming pass, tracked in memory (`project_corpflow_second_adapter_pivot`), and does not block or get designed as part of this spec. Where it's relevant, this spec calls out that new interfaces stay non-breaking-extensible toward that future need, without building anything for it now (YAGNI).

## Verification Note: why this design differs from a first-pass reading of `ARIA-Reference.md`

A gap-analysis pass on an early version of this design assumed `detectSentiment` was a fully generic, zero-config function, based on `ARIA-Reference.md`'s prose summary ("the detector itself is domain-agnostic text analysis"). Re-reading the actual `aria-sentiment.ts` source disproved this: its `POSITIVE_PATTERNS` list bakes in fitness-specific vocabulary (`nailed`, `crushed it`, `personal best`, `pb`, `pr`) alongside generic positive words. **The doc's paraphrase was accurate at the level of "this subsystem exists and is real" but not precise enough to make an architecture decision from directly.** This spec is built from re-reading `aria-sentiment.ts`, `aria-guardrails.ts`, `aria-memory.ts`, and `aria-tools.ts` directly, not from the doc summary alone. A subsequent alignment-analysis pass flagged that this same direct-source verification had *not* been done for tools before an early draft of this spec — it has been, in the final pass; see the tools section below.

## Core Additions to `@aria/core`

Three new modules, following the existing config-injection pattern already used by `RateLimiter`, `FallbackEngine`, and `AriaPromptConfig` — not a new architectural idiom.

### `guardrail-filter.ts` — `GuardrailFilter`

Config-injected: `categories: { key: string; pattern: RegExp; redirectMessage: string }[]`, `wellnessOverridePattern: RegExp`, `defaultRedirectMessage: string`, `shortMessageThreshold: number`.

`check(message: string): { allowed: boolean; redirectMessage?: string }` implements the real three-step precedence exactly: (1) messages shorter than `shortMessageThreshold` are always allowed, (2) a match against `wellnessOverridePattern` allows the message through even if it also matches an off-topic category, (3) only then are `categories` checked in order, returning the matched category's `redirectMessage` (or `defaultRedirectMessage` if none matched by key).

**Ordering with the existing `checkSafety` crisis filter:** `checkSafety` (Phase 1, `safety-filter.ts`) and `GuardrailFilter` (this phase) have no real-app precedent for their relative order — `checkSafety` doesn't correspond to any standalone file in real My Body source; it was designed fresh during Phase 1 to close RISK-002, while `GuardrailFilter` is a faithful port of real `aria-guardrails.ts`. They never coexisted in production, so there is nothing to be "faithful" to here — this is a new decision. **`checkSafety` always runs first and unconditionally short-circuits before `GuardrailFilter` is ever called**, matching its existing position at the top of `sendMessage()` (`chat-engine.ts:80`). This guarantees crisis detection always wins over a topic redirect for any message matching both (e.g., self-harm language that also happens to mention a category keyword). This ordering is a pinned, documented contract in `chat-engine.ts`, not an incidental consequence of file layout.

Because rate-limit consumption already happens unconditionally before either check (`chat-engine.ts:75`), a topic-guardrail block consumes the day's quota exactly the same way a crisis block already does — consistent by construction with Phase 1's existing (documented, deferred) stance that a safety-blocked message still counts against the daily limit.

### `sentiment.ts` — `SentimentDetector`

**Revised from an earlier draft that treated this as a pure, zero-config function.** Config-injected, same shape as `GuardrailFilter`: `distressPatterns: RegExp`, `negativePatterns: RegExp`, `positivePatterns: RegExp`, `highEnergyPatterns: RegExp`, `lowEnergyPatterns: RegExp`, `requestKeywords: RegExp`. Question-detection and greeting-detection stay hardcoded core defaults — the real source's patterns for these (`?` + `how/what/why/when/should/can/could/is it/do you/does/will`; `hi/hello/hey/...`) are genuinely domain-agnostic, unlike the other six pattern sets, which all contain or could plausibly contain domain vocabulary (confirmed for positive/request; treated conservatively as adapter content for all six rather than re-guessing which ones are "obviously" generic, since that guess was already wrong once this session).

`detect(message: string): SentimentHint` implements the real precedence: distress patterns checked first and short-circuit to `{ mood: 'distressed', energy: 'low', intent: 'venting' }`; otherwise mood from positive/negative keyword counting, energy from high/low-energy pattern matching (default `'medium'`), intent from question → venting → celebration → request → greeting → `'unknown'`, checked in that order.

`SentimentHint` (the output type) and its five-branch prompt-injection logic are unchanged from the doc — but `buildSentimentPromptSection(hint): string` (the wording) is adapter-fitness content, not core, since it references "workout suggestions" explicitly.

### `memory-manager.ts` — `MemoryManager`, plus a new `AriaMemoryStore` interface

**Owns both the write side (summarization) and read side (retrieval + prompt rendering)** — an earlier draft only covered write, which would have shipped a memory system that writes but never surfaces anything back into conversation.

New core type (`types.ts`):
```typescript
export interface AriaMemoryEntry {
  memoryType: 'conversation_summary' | 'user_preference' | 'goal' | 'concern';
  content: string;
  sourceDate: Date;
}

export interface AriaMemoryStore {
  /** Count of messages strictly after `since` — mirrors the real app's `created_at`-based gate. */
  countMessagesSince(userId: string, since: Date): Promise<number>;
  /** Timestamp of the most recently saved memory, or null if none exists. Used only for the gate, never for retrieval ordering. */
  getLastSummarizedAt(userId: string): Promise<Date | null>;
  /** Up to `limit` memories, ordered by `sourceDate` descending. Used only for retrieval, never for the gate. */
  getMemories(userId: string, limit: number): Promise<AriaMemoryEntry[]>;
  saveMemory(userId: string, entry: AriaMemoryEntry): Promise<void>;
}
```

Deliberately keeping `getLastSummarizedAt` (gate timestamp) and `getMemories`'s `sourceDate` ordering (retrieval timestamp) as two distinct fields/methods: the real `aria-memory.ts` uses `created_at` for the "≥10 messages since last summary" gate and `source_date` for retrieval ordering — two different real columns. An earlier draft of this spec collapsed them into one ambiguous `getLastMemoryDate()`, which would have been a faithfulness break introduced by this port, not inherited from the source.

`MemoryManager` config: `extractionPrompt: string`, `summarizerProvider: LLMProvider`, `historyStore: AriaHistoryStore` (reused from Phase 1, no new type needed for message loading), `memoryStore: AriaMemoryStore`, `maxMessagesLoaded = 30`, `minMessagesToTrigger = 10`, `maxMemoriesReturned = 20`.

- `maybeSummarize(userId: string): Promise<void>` — loads up to `maxMessagesLoaded` recent messages via `historyStore`; bails if fewer than `minMessagesToTrigger` exist; if a memory already exists, bails unless `countMessagesSince(userId, lastSummarizedAt) >= minMessagesToTrigger`; otherwise calls `summarizerProvider` with `extractionPrompt`, parses the JSON response, deduplicates case-insensitively against existing memory content, and saves each accepted entry individually. **Guards against overlapping calls for the same user** with a per-user in-flight `Set<string>`, released in a `finally` block so a thrown error doesn't permanently block that user's future summarization. Callers must invoke this without `await` and with an explicit `.catch()` (matching the real app's fire-and-forget pattern) — this is a documented contract on the method, not enforced by the type system.
- `buildMemoryPromptSection(userId: string): Promise<string>` — fetches via `getMemories` and renders the `## WHAT YOU REMEMBER FROM PAST CONVERSATIONS` block, matching the real `buildMemoryPromptSection()`'s formatting and its "ask if outdated" instruction. Returns `''` if there are no memories.

Adapter-fitness implements `AriaMemoryStore` as a simple in-memory store, matching the "no real DB" scope decision — this is new (Phase 1's `InMemoryHistoryStore` covers chat messages, not the separate memory concept), and is written specifically for this phase rather than assumed trivial.

### Extension to `tools.ts` / `ChatEngine`: `mutatesContext` flag and cache invalidation

Re-reading `aria-tools.ts` and `chat-engine.ts` together (closing the one subsystem an alignment-analysis pass found had been designed without this verification step, unlike guardrails/sentiment/memory) surfaced a real, previously unflagged gap: **`ChatEngine`'s tool-execution loop (`chat-engine.ts:161-187`) has no cache-invalidation hook at all, and tool handlers only ever receive `(userId, args)` — they have no way to reach `contextProvider` even if they wanted to.** The real app invalidates cached context specifically after `log_water`/`log_mood` execute (`aria-chat.ts`'s router, not `aria-tools.ts` itself).

Resolution: `ToolDefinition` (`types.ts`) gains an optional `mutatesContext?: boolean`. After executing each tool call in the loop, `ChatEngine` checks the executed tool's definition and — if `mutatesContext` is true — calls `this.deps.contextProvider.invalidate(userId)`, fire-and-forget with errors swallowed, matching the real `.catch(() => {})` pattern. This is mechanism (a generic "this tool's effects can stale the cache" concept); which specific tools set the flag (`log_water`, `log_mood`) is adapter-fitness content.

Adapter-fitness's tool handlers should replicate the real handlers' argument clamping/defaulting (e.g., `Math.min(30, Math.max(1, days ?? 7))` for day-count parameters, 1-5 clamping for mood/energy/stress ratings) since AJV schema validation in `ToolRegistry.execute()` rejects invalid args but doesn't clamp or default them. Handlers should **not** duplicate `ToolRegistry`'s own try/catch-to-error-string wrapping, which already centralizes this in core — faithfulness targets observable behavior, not literal code structure.

### System-prompt composition order

An explicit, pinned order — not left as prose the way an earlier draft did — matching the real app: personality core → expertise/rules/context (`AriaPromptConfig.injectContext`) → sentiment section (`buildSentimentPromptSection`) → memory section (`buildMemoryPromptSection`). `context` (via `contextProvider`) and the memory section (via `memoryStore`) are both async and independent of each other, so they may be fetched concurrently; `GuardrailFilter.check` and `SentimentDetector.detect` are synchronous and message-only.

## Data Flow in `ChatEngine.sendMessage()`

1. Rate-limit check (unchanged from Phase 1).
2. `checkSafety(content)` — crisis filter, short-circuits on match (unchanged from Phase 1, now documented as running strictly before step 3).
3. `guardrails.check(content)` — topic filter, short-circuits on match with the redirect message.
4. `sentiment.detect(content)` — always runs if steps 2–3 didn't short-circuit.
5. Build context (cached or fresh) and the memory prompt section concurrently.
6. Compose system prompt in the pinned order above.
7. Main LLM call with tool definitions.
8. If tool calls returned: execute each via `ToolRegistry`, invalidate cache for any `mutatesContext` tool, make the tool-results follow-up call (unchanged from Phase 1's user-role-turn fix).
9. Save the assistant message, return the result.
10. Fire-and-forget `memory.maybeSummarize(userId).catch(...)` — not awaited, does not affect the returned result.

## `@aria/adapter-fitness` Package Contents

```
packages/adapter-fitness/
├── package.json                    # depends on @aria/core, mirrors adapter-example's shape
├── src/
│   ├── context-provider.ts         # injected/mocked fitness context (no real DB)
│   ├── prompt-config.ts            # fitness expertise, EASE-aligned rules
│   ├── tools.ts                    # the 8 real tools, faithful handler logic, mutatesContext on log_water/log_mood
│   ├── guardrails-config.ts        # the real 7 categories + wellness-override pattern + redirect copy
│   ├── sentiment-config.ts         # the real 6 pattern sets + buildSentimentPromptSection wording
│   ├── memory-config.ts            # the real extraction prompt + an in-memory AriaMemoryStore implementation
│   ├── fallback-responses.ts       # unchanged pattern from Phase 1
│   └── index.ts                    # wires everything into a ChatEngine instance
└── test/
    ├── context-provider.test.ts
    ├── tools.test.ts
    ├── guardrails-config.test.ts
    ├── sentiment-config.test.ts
    ├── memory-config.test.ts
    └── integration.test.ts         # end-to-end ChatEngine.sendMessage(), mirrors adapter-example's pattern
```

## `@aria/adapter-example` Update

Gets minimal (not necessarily realistic) guardrails/sentiment/memory config added — a couple of off-topic categories, a couple of sentiment pattern sets, a short extraction prompt — so all three new core mechanisms are exercised against **two** domains, not one, matching the bar Phase 1 already held tools/context/prompt/fallback to. This is the direct fix for the gap-analysis finding that adapter-fitness alone can't prove these mechanisms generalize (adapter-fitness and the team building it share the same source of truth; adapter-example is the independent check). Must not break adapter-example's existing tests — new `ChatEngine` constructor deps for guardrails/sentiment/memory stay optional, verified against the existing test suite before this is called done.

## Testing Strategy

- Unit tests per new core class (`GuardrailFilter`, `SentimentDetector`, `MemoryManager`), exercised with both adapter-example's and adapter-fitness's configs.
- `AriaMemoryStore`'s in-memory adapter-fitness implementation gets its own unit tests covering the gate/dedup/ordering logic specifically (the exact place a subtle bug hid in an earlier draft of this spec).
- End-to-end integration test via `ChatEngine.sendMessage()` in adapter-fitness, mirroring `adapter-example`'s existing `integration.test.ts` pattern.
- **A manual live-API smoke test, explicitly scoped to memory** (not generic "does chat still work"): send 10+ messages against a real Anthropic/OpenRouter key and assert a memory entry is actually written and appears in the next turn's system prompt. This directly addresses the risk that a fire-and-forget, error-swallowing subsystem could ship completely non-functional and invisible to stub-based tests — the same failure class that has already bitten this project twice (the tool-call-follow-up prefill 400, the retired default model ID).

## Documentation & Risk Register Updates

- `RISK-REGISTER.md` gets a new **RISK-003** (filed alongside this spec): guardrail-category and sentiment-pattern lists are hand-maintained and not exhaustive — same risk class as RISK-002, lower severity since crisis detection is a separate, earlier-running mechanism.
- `ARIA-Reference.md` or the adapter-fitness README gets two explicit limitation notes: (1) adapter-fitness's content is a dated snapshot of real My Body source as of 2026-08-28, not auto-synced — if My Body's real tools/categories/prompts change later, this adapter will silently drift, mirroring the exact `ARIA-Reference.md`-vs-code drift this project already had to correct once; (2) guardrail/sentiment/memory content is intentionally hardcoded per-package-version for this phase, not dynamically configurable — a deliberate, stated limitation, not an oversight.

## Relationship to the CorpFlow Direction

Not designed here, but checked for compatibility: `GuardrailFilter.check(message)`, `SentimentDetector.detect(message)`, and `MemoryManager.maybeSummarize(userId)` all stay non-breaking-extensible toward a future tenant dimension — either by namespacing `userId` at a future adapter's layer, or by an additive optional parameter later. A future `@aria/adapter-corpflow` would construct its own tenant-aware configuration rather than requiring these signatures to change. No tenant-scoping work is done in this phase.

## Open Items Carried Into the Implementation Plan

- Exact `AriaMemoryEntry.memoryType` validation (the real code falls back to `'conversation_summary'` for an unrecognized type string from the LLM's JSON output) — carry this defaulting behavior into `MemoryManager.maybeSummarize`.
- Confirm `@aria/adapter-example`'s existing test suite passes unmodified after `ChatEngine` gains the new optional constructor deps, before this phase is called done.
