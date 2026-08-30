# @aria/core

The universal ARIA engine — personality, chat orchestration, rate limiting, tool-use, and safety filtering, decoupled from any single app's domain.

## Security Contract

**This package performs no authentication or authorization.** Every method on `AriaContextProvider`, `AriaHistoryStore`, and every `Tool` handler receives a raw `userId: string` on faith. The consuming app's route layer is responsible for verifying the caller's authenticated session matches `userId` *before* calling `ChatEngine.sendMessage()` or any core interface method directly. Passing an unverified or client-supplied `userId` is a direct cross-user data exposure vulnerability.

Tool handlers must derive all data scope from the `userId` parameter they're called with — never from a field inside `args`, even if a future tool schema is tempted to add one.

### Safety filter limitations

`checkSafety()` is an **English keyword/regex filter with known false negatives**. It is not exhaustive, and it inspects the **user's message only** — there is no output-side filtering of the assistant's response. Treat it as a first fail-closed layer, not a guarantee. See RISK-002 in the project's `RISK-REGISTER.md`.

Its second parameter is named `crisisResponse` for a reason: it is the reply to return when a pattern matches, never text that also gets scanned. Passing model output there would silently defeat the check.

### Tool errors reach the LLM prompt verbatim

On a tool-call failure, the tool's error string — including raw JSON-Schema validation text from `ajv` and any exception message thrown by a tool handler — is interpolated directly into the follow-up LLM prompt. **Tool handlers must never put internal implementation detail, stack traces, or PII into a thrown error message**, because it becomes part of the conversation the LLM (and its provider) sees.

### Rate limiting is not atomic

`RateLimiter` is check-then-act against whatever `AriaHistoryStore` is supplied — it counts, then the caller writes. That is fine for `InMemoryHistoryStore` in a single process, but a concurrency-safe store implementation needs its own locking/atomicity strategy if used under concurrent requests for the same user; otherwise two in-flight requests can both pass the check.

### Message retention is the consuming app's responsibility

Message content is persisted **verbatim** by whatever `AriaHistoryStore` the consuming app supplies. This package defines no retention window, no redaction, and no deletion policy beyond the `clearMessages(userId)` interface method — retention and deletion policy are entirely the consuming app's responsibility. See RISK-001 in the project's `RISK-REGISTER.md`.

### Error visibility

`ChatEngine` catches every failure inside response generation and renders the fallback-engine reply, so an LLM outage, a context-provider exception, and a history-store failure all look identical to the user. Pass the optional `onError` hook on `ChatEngineDeps` to get telemetry:

```ts
new ChatEngine({
  /* ... */
  onError: ({ userId, stage, error }) => logger.error({ userId, stage, err: error }),
});
```

`stage` is `'context' | 'llm' | 'tool'`. Wire it to your logger — without it, a broken LLM integration is indistinguishable from a normal fallback.

## Build Before Test or Typecheck

`@aria/core` resolves through its `exports` map to `packages/core/dist/`, which is gitignored. **The package must be built before anything in the workspace typechecks or runs tests against it**:

```bash
npm run build --workspace=packages/core
```

Root `npm test` and `npm run typecheck` do this automatically via `pretest` / `pretypecheck` scripts, so a clean clone works and a stale `dist` can never silently pass a suite against old source. If you invoke `tsc` or `vitest` **directly** — outside those root scripts — build first yourself, or you will validate the previous build.

## Versioning & Distribution

This package is not published to a registry. Consuming apps outside this monorepo should pin it via a git-tag dependency:

```json
{
  "dependencies": {
    "@aria/core": "github:twalibey/aria-core#v0.1.0",
    "@aria/adapter-corpflow": "github:twalibey/aria-core#v0.1.0"
  }
}
```

Never depend on a floating branch (e.g. `#main`) — a change made for one consuming app would silently change behavior for every other app pinned the same way. Releases are tagged with semver; a breaking interface change bumps the major version.

Tags are cut from whatever commit is ready for external consumption, not necessarily `main` — e.g. `v0.1.0` was cut mid-development from the `worktree-aria-corpflow-tenant-scoping` branch (Tasks 1-8 of the CorpFlow tenant-scoping plan) so CorpFlow could start consuming `@aria/adapter-corpflow` before that work merged to `main`. Consuming apps should always repin to a new tag once the underlying feature branch merges, rather than staying on a pre-merge tag indefinitely.

## Deployment Requirement: Per-App API Keys

Each consuming app should use its own `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY`. Sharing one key across multiple apps means a leak or cost-abuse incident in any single app compromises every other app using that key.

## Non-Goals (Phase 1)

Streaming responses, long-term conversation memory, sentiment-aware prompting, full topic guardrailing (only the crisis/medical-symptom safety filter is included), proactive nudges, and multimodal/vision support are all deferred — see `docs/superpowers/specs/2026-08-13-aria-core-extraction-design.md`.
