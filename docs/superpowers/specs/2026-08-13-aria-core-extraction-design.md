# ARIA Core Extraction — Design Spec

**Date:** 2026-08-13
**Status:** Approved, pending final user review of this file
**Source material:** `ARIA-Reference.md` (existing 2000+ line reference doc for the ARIA pattern as implemented in the My Body fitness app)

## What This Is

Extract ARIA — currently ~1,400 lines of TypeScript living inside the My Body fitness app — into a standalone, provider-agnostic package (`@aria/core`) that any future app can adopt via a thin domain-specific adapter, per the "Making ARIA Cross-Project" blueprint already documented in `ARIA-Reference.md`.

This spec covers **Phase 1 only**: the core engine, its interfaces, and one synthetic adapter built purely to validate those interfaces. It does **not** cover extracting My Body's real fitness logic (that's Phase 2, named below) or any of the roadmap's deeper enhancements (streaming, long-term memory, sentiment, nudges, full topic guardrailing, vision — all explicitly deferred, except a narrow safety-critical subset carved out below).

## Known Limitation: Unvalidated Against the Real Codebase

This design is built entirely from `ARIA-Reference.md` — an aspirational/documentation source, not the actual current My Body production code. Reading the real implementation was attempted and blocked (macOS sandbox permissions prevented this session from browsing outside the `ARIA/` project folder), and the decision was made to proceed without resolving it rather than block Phase 1 on it. This is an accepted, explicitly tracked gap, not a silent one: **Phase 2 (the real `adapter-fitness` extraction) cannot start until this is resolved** — either by granting filesystem access or by copying the relevant source files (`aria-context.ts`, `aria-system-prompt.ts`, `aria-chat.ts`, `plan-generate.ts`, migration SQL) into this repo for direct comparison.

## Why a Synthetic Adapter, Not "Interfaces Only"

The original plan was core + interfaces with no adapter at all. A red-team pass on that plan found the load-bearing flaw directly: interfaces designed against a sample size of one domain (fitness) plus imagination of others is not a validated abstraction — it's fitness-shaped code wearing generic type parameters, and it would ship with zero feedback on whether it actually generalizes. The fix folded into this design: build one throwaway synthetic adapter (fake domain, in-memory mock data, never shipped) whose only job is exercising every core interface once before anything is locked in.

## Security & Privacy — Threat Model Findings

A threat-model pass (STRIDE across 6 trust boundaries) surfaced three P1s and two P2s that change the design, not just the risk register:

1. **Core performs zero authorization verification of `userId`.** Every interface method takes a raw `userId: string` on faith. This is now a **hard, documented contract**: core is not an auth system. Every adapter's route layer MUST verify the caller's session matches `userId` before calling into core — stated explicitly in the interface docs below, not left implicit (this is exactly the gap that almost shipped silently).
2. **Full sensitive context is sent to a third-party LLM provider on every message**, with no minimization, redaction, or consent step. Core cannot fix this by itself — it's a disclosure that must be documented and consented to at the product level (see Privacy section below). Core's obligation: never silently expand what's sent beyond what `AriaPromptConfig.injectContext()` explicitly returns.
3. **LLM-emitted tool-call arguments reached handlers unvalidated.** Fixed structurally: `tools.ts` now validates `args` against the tool's declared JSON Schema before invoking the handler, rejecting on mismatch instead of trusting LLM output.
4. **Tool handlers could accept a caller-suppliable identity field.** Fixed as a hard rule: tool handlers derive all scope from the `userId` parameter they're called with; a `Tool` definition MUST NOT declare a parameter that identifies a different user, and `tools.ts` treats this as a design-time constraint documented alongside `ToolDefinition`.
5. **A single LLM API key shared across every consuming app multiplies blast radius.** Documented as a deployment requirement: each consuming app should use its own `OPENROUTER_API_KEY`/`ANTHROPIC_API_KEY`, not a key shared across adapters.

## Privacy & Data Handling

A privacy-terms-check pass classified ARIA's data (health conditions, medications, pregnancy status, injury history, plus free-text chat disclosures) as **High tier** — the tier requiring a full privacy policy and a specific regulatory basis before real users, including beta users, are onboarded. Currently **no privacy policy or ToS exists** for My Body or this package, and the OpenRouter/LLM-provider data flow is undocumented as a subprocessor relationship anywhere.

This is filed as a risk-register item, not solved by this spec:

> **Risk:** No privacy policy or ToS exists despite collecting High-tier health data and transmitting it to a third-party LLM provider on every message. **Likelihood:** High (confirmed absent). **Impact:** High (regulatory exposure, loss of user trust). **Action:** draft/review a policy covering what's collected, the LLM subprocessor disclosure, retention, deletion rights, and jurisdiction-specific provisions once target markets are known. **Blocking before any real or beta user is onboarded to any adapter built on this core** — not blocking for Phase 1's synthetic-adapter-only work, since no real user data is ever involved there.

## Safety: Crisis/Medical-Language Fail-Safe (pulled into Phase 1 scope)

ARIA is not built on a licensed professional's credential (scope-guard's formal protocol doesn't trigger), but the adjacent risk is real: the "never give medical advice, redirect to a doctor" rule currently exists only as a system-prompt instruction, with no verification layer catching the model if it doesn't reliably comply — particularly relevant since users are expected to type distress/pain/symptom language directly into chat. This was roadmap gap #9 (Topic Guardrailing), previously deferred in full.

**Resolution:** split the scope. Full topic guardrailing (redirecting finance/politics/programming questions) stays deferred — it's a UX nicety, not a safety issue. A narrow **`safety-filter.ts`** module is pulled into Phase 1: a fail-closed, pre-LLM pattern check for crisis-adjacent and acute-medical-symptom language (self-harm signals, "chest pain," "can't breathe," etc.), modeled on the off-topic filter pattern already designed in `ARIA-Reference.md`. On a match, core skips the LLM call entirely and returns a fixed, adapter-overridable "please seek professional/emergency help" response. This is safety-critical, not a nice-to-have, so it ships with Phase 1 rather than waiting for a real adapter.

## Repository Structure

```
ARIA/
├── package.json                    # npm workspace root
├── tsconfig.base.json
├── vitest.config.ts
├── RISK-REGISTER.md                # the two entries above, tracked
├── packages/
│   ├── core/                       # @aria/core
│   │   ├── src/
│   │   │   ├── types.ts            # all shared interfaces (below)
│   │   │   ├── personality.ts      # EASE philosophy, shared tone rules
│   │   │   ├── chat-engine.ts      # orchestration
│   │   │   ├── rate-limiter.ts     # tier-based, timezone-aware
│   │   │   ├── fallback-engine.ts  # base class for keyword fallback
│   │   │   ├── safety-filter.ts    # NEW — crisis/medical-language fail-safe
│   │   │   ├── tools.ts            # tool registry + executor + schema validation
│   │   │   ├── history/
│   │   │   │   └── in-memory-store.ts   # reference AriaHistoryStore impl
│   │   │   ├── providers/
│   │   │   │   ├── openrouter.ts   # default LLM provider
│   │   │   │   └── anthropic.ts    # secondary LLM provider
│   │   │   └── index.ts
│   │   ├── package.json            # dual ESM+CJS build via tsup
│   │   ├── README.md               # documents auth contract + versioning convention
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
/**
 * SECURITY CONTRACT: core performs NO authentication or authorization.
 * The caller (adapter route layer) MUST verify the request's authenticated
 * session matches `userId` before invoking any of these methods. Passing
 * an unverified or client-supplied userId is a direct cross-user data
 * exposure vulnerability — this is the adapter's responsibility, not core's.
 */
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
  parameters: object; // JSON Schema — validated against actual LLM-emitted
                       // arguments before the handler ever runs (see tools.ts).
                       // MUST NOT declare a parameter that identifies a user
                       // other than the caller — handlers scope exclusively
                       // via the `userId` argument, never via `args`.
}

interface Tool<TArgs = any> {
  definition: ToolDefinition;
  handler: (userId: string, args: TArgs) => Promise<string>;
}
```

`LLMProvider` is deliberately shaped like OpenAI-style function-calling (OpenRouter is already OpenAI-compatible). Provider-specific translation — including Anthropic SDK's differing tool-call format — lives entirely inside `providers/openrouter.ts` and `providers/anthropic.ts`. Core logic never sees provider-specific quirks; this is what prevents the abstraction from leaking.

## `chat-engine.ts` — Orchestration

1. Rate limit check (via `rate-limiter.ts`, which calls `AriaHistoryStore.countMessagesSince`)
2. **Safety filter check (`safety-filter.ts`)** — if the message matches crisis/acute-medical-symptom patterns, skip straight to a fixed fail-closed response; do not call the LLM
3. Save user message (`AriaHistoryStore.saveMessage`)
4. Load recent history (`AriaHistoryStore.getRecentMessages`)
5. Get or rebuild context (`AriaContextProvider.getCachedContext` / `buildContext`)
6. Build system prompt (`AriaPromptConfig.injectContext` + personality core)
7. Call LLM (`LLMProvider.call`, with registered tools passed through)
8. If the response includes tool calls: for each, **validate `arguments` against the tool's JSON Schema first**; on validation failure or an unregistered tool name, produce a structured error result fed back to the LLM rather than executing anything. On a validated call, execute inside try/catch — thrown errors also become a structured error result rather than crashing the request. All tool failures route through an injectable `onToolError` hook for future observability.
9. On LLM/provider failure at any point: degrade to `fallback-engine.ts`, never leave the user without a response.
10. Save ARIA's response (`AriaHistoryStore.saveMessage`)

## `rate-limiter.ts`

Tier-based daily limits (free/premium), timezone-aware from day one — this closes roadmap gap #3 as a structural property of core rather than a later patch. Uses `AriaHistoryStore.countMessagesSince` with the user's local midnight, not server UTC midnight.

## Event-Driven Context Invalidation

Roadmap gap #1 (event-driven context invalidation) is brought into core alongside tool-use, timezone rate limiting, and the safety filter, so all critical-and-safety items are handled consistently in this phase rather than an inconsistent subset. `AriaContextProvider.invalidate(userId)` is the mechanism; each adapter's own app routes call it after writes relevant to their domain (core defines and honors the interface, never calls it itself, since only the app knows when its data changed).

## `tools.ts` — Tool Registry

Generic registration/execution framework, closing roadmap gap #2. Each adapter (synthetic now, real domains later) registers its own tools with `name` + `description` + JSON-schema `parameters` + `handler` — the same shape this very Claude Code skill library uses for its own skills. Tools are registered independently of `AriaPromptConfig`, not folded into it, so prompt construction and tool availability stay separately testable. **Before any handler runs, `arguments` are validated against `parameters`** — this is the fix for the threat model's tampering finding (unvalidated LLM-emitted tool arguments reaching handler code).

## `safety-filter.ts` — Crisis/Medical-Language Fail-Safe (NEW)

Pre-LLM, fail-closed pattern check for crisis-adjacent and acute-medical-symptom language. On a match, returns a fixed, adapter-overridable "seek professional/emergency help" response and skips the LLM call entirely — consistent (deliberately) with how the off-topic filter is designed in `ARIA-Reference.md`, but scoped narrowly to safety, not general topic policing. Full topic guardrailing (finance/politics/programming redirects) remains deferred.

## `fallback-engine.ts`

Base class for keyword-matched fallback responses (used when the LLM provider fails or no API key is configured). Each adapter overrides with its own domain-specific keyword responses.

## Versioning & Distribution

- **Within this repo:** `adapter-example` (and any future real adapters, if ever colocated here) consume `@aria/core` via the npm workspace protocol — always in sync, single source of truth.
- **External consumers** (separate app repos — My Body and whatever comes next): pin `@aria/core` via a **git-tag dependency** (`"@aria/core": "github:<you>/aria#v0.1.0"`), never a floating branch. The core repo tags releases with semver; a breaking interface change bumps major. This directly closes the operational gap where "several apps, fairly soon" combined with unpinned relative imports would have let a change for app #2 silently break app #1's production code.
- **Deployment requirement:** each consuming app uses its own LLM provider API key. A key shared across multiple adapters multiplies the blast radius of any single leak (threat-model finding).

## My Body Migration — Phase 2 (named, tracked, not built this phase)

My Body's current inline ARIA implementation keeps running unmodified until a real `adapter-fitness` package is built and validated against `@aria/core`. Only then does My Body swap its internal `aria-*.ts` files for the package + adapter, behind a feature flag, with the old inline code deleted only after confirmed parity. **Phase 2 cannot start until the real codebase is actually readable** (see Known Limitation above) — this spec was built from the reference doc alone and has never been checked against the live implementation.

## Explicit Non-Goals This Phase

Streaming responses, long-term conversation memory/summarization, sentiment-aware prompting, full topic guardrailing (off-topic redirects — the safety-critical crisis/medical subset is now in scope, see above), proactive nudges, multimodal/vision support. All require a real (non-synthetic) adapter in production to validate against, which this phase deliberately doesn't have.

## Skills Used in This Project

Documented so future phases know which Claude Code skills to invoke, and when, rather than re-deriving this each time:

**At defined gates:** `threat-model` and `privacy-terms-check` (before any new adapter or tool touching user data), `security-review` / `secrets-audit` (once real code exists, before each phase is called done), `ground-truth` (verify actual OpenRouter/Anthropic SDK signatures before coding provider files — the reference doc's samples may be stale), `spec-code-drift-audit` (ongoing, keeps this spec and real code from diverging), `gap-analysis` / `red-team` (per phase, as already used), `tech-debt-audit` / `code-quality` / `test-coverage` (before any phase is called done), `model-advisor` (choosing `ARIA_MODEL` defaults), `claude-api` (reference for the Anthropic SDK provider), `superpowers:test-driven-development` / `superpowers:verification-before-completion` (during implementation).

**Situational:** `architecture-brief` (once core is built), `feature-inventory`/`project-health` (periodic roadmap check), `llm-api-resilience-pass` (when building `chat-engine.ts`'s provider-failure/fallback logic), `ghost`/`humanize-output` (QA'ing ARIA's actual conversational output once live, not the code), `launch-checklist`/`incident-postmortem` (at real ship time / after incidents), `accessibility-review` (once a real chat UI exists).

**Future-phase (monetization/growth):** `billing-model-decision`, `stripe-billing-audit`, `pricing-integrity`, `churn-retention-analysis`, `onboarding-flow-design`, `data-analyst`.

## Success Criteria

- `@aria/core` scaffolded; dual ESM/CJS build compiles clean
- All interfaces above (`AriaContextProvider` incl. invalidation, `AriaHistoryStore` incl. `countMessagesSince`, `AriaPromptConfig`, `LLMProvider`, `Tool`/`ToolRegistry` incl. schema validation) defined and implemented
- Security contract (no built-in auth; adapter verifies session before calling core) documented in `packages/core/README.md`, not just this spec
- `safety-filter.ts` implemented and covers at minimum: self-harm signals, acute-medical-symptom phrases
- `adapter-example` implements every core interface once, proving they're exercisable by a second (synthetic) domain shape — not just internally consistent on paper
- Unit tests (Vitest) pass against the in-memory history store and synthetic adapter; no real database or live LLM call required
- Versioning convention (git-tag pinning) and per-app-API-key requirement documented in `packages/core/README.md`
- `RISK-REGISTER.md` created with the two entries above (privacy policy gap, crisis-safety verification)
- My Body migration path named as Phase 2 in this spec, explicitly blocked on codebase access being resolved
- This design doc written, self-reviewed, and handed to the `writing-plans` skill for the implementation plan
