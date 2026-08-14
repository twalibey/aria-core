# @aria/core

The universal ARIA engine — personality, chat orchestration, rate limiting, tool-use, and safety filtering, decoupled from any single app's domain.

## Security Contract

**This package performs no authentication or authorization.** Every method on `AriaContextProvider`, `AriaHistoryStore`, and every `Tool` handler receives a raw `userId: string` on faith. The consuming app's route layer is responsible for verifying the caller's authenticated session matches `userId` *before* calling `ChatEngine.sendMessage()` or any core interface method directly. Passing an unverified or client-supplied `userId` is a direct cross-user data exposure vulnerability.

Tool handlers must derive all data scope from the `userId` parameter they're called with — never from a field inside `args`, even if a future tool schema is tempted to add one.

## Versioning & Distribution

This package is not published to a registry. Consuming apps outside this monorepo should pin it via a git-tag dependency:

```json
{
  "dependencies": {
    "@aria/core": "github:<you>/aria#v0.1.0"
  }
}
```

Never depend on a floating branch (e.g. `#main`) — a change made for one consuming app would silently change behavior for every other app pinned the same way. Releases are tagged with semver; a breaking interface change bumps the major version.

## Deployment Requirement: Per-App API Keys

Each consuming app should use its own `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY`. Sharing one key across multiple apps means a leak or cost-abuse incident in any single app compromises every other app using that key.

## Non-Goals (Phase 1)

Streaming responses, long-term conversation memory, sentiment-aware prompting, full topic guardrailing (only the crisis/medical-symptom safety filter is included), proactive nudges, and multimodal/vision support are all deferred — see `docs/superpowers/specs/2026-08-13-aria-core-extraction-design.md`.
