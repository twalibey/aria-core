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

This package is not published to a registry, and this repo (`aria-core`) is an npm-workspaces monorepo — the repo root itself is **not** installable as a dependency (its `package.json` has no `main`/`exports`, and the real packages live under `packages/*`). Installing `github:twalibey/aria-core#<tag>` directly would clone the whole monorepo root into `node_modules`, which Node cannot resolve anything from.

Instead, each publishable package (`@aria/core`, `@aria/adapter-corpflow`, and any future adapter meant for external consumption) gets its own **per-package release branch**, cut via `git subtree split`, so that package's own directory becomes the root of that branch:

```bash
git subtree split --prefix=packages/core -b release-core
git tag core-v0.1.0 release-core

git subtree split --prefix=packages/adapter-corpflow -b release-adapter-corpflow
git tag adapter-corpflow-v0.1.0 release-adapter-corpflow
```

A consuming app pins each package to its own `<package>-vX.Y.Z` tag, not a shared repo-wide tag:

```json
{
  "dependencies": {
    "@aria/core": "github:twalibey/aria-core#core-v0.1.0",
    "@aria/adapter-corpflow": "github:twalibey/aria-core#adapter-corpflow-v0.1.0"
  }
}
```

Never depend on a floating branch (e.g. `#main` or the raw `#release-core` branch itself) — pin to the tag. A change made for one consuming app would otherwise silently change behavior for every other app pinned the same way. Releases are tagged with semver; a breaking interface change bumps the major version.

Cutting a new release means re-running the subtree split against the desired commit and creating a new tag — this is currently a manual step (a future improvement could script it). Each package's release branch is independent: bumping `core-vX` does not require re-cutting `adapter-corpflow-vX`, except when adapter-corpflow's own code or its `@aria/core` devDependency pin actually needs to change.

### Local package.json changes needed for git-tag installs

Any *new* publishable package added to this monorepo in the future must, in its own directory:

- Have a standalone-buildable `tsconfig.json` — inline the shared compiler options directly rather than `"extends"`-ing anything outside the package's own directory (e.g. `../../tsconfig.base.json`). Once the package becomes the root of a subtree-split release branch, nothing outside that directory exists anymore.
- Declare its own build-tool `devDependencies` (e.g. `typescript`, `tsup`) rather than relying on the monorepo root's hoisted versions — a standalone install of just one package won't have those hoisted.
- Add a `"prepare": "npm run build"` script alongside its `build` script — `prepare` is what npm runs automatically right after installing a git dependency, and it's what makes the package self-building on install with no monorepo context required.

Skipping any of these hits the exact resolution failure (`main`/`exports`/`dist` not resolving, or a hoisted-only build tool missing) that this mechanism exists to avoid.

## Deployment Requirement: Per-App API Keys

Each consuming app should use its own `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY`. Sharing one key across multiple apps means a leak or cost-abuse incident in any single app compromises every other app using that key.

## Non-Goals (Phase 1)

Streaming responses, long-term conversation memory, sentiment-aware prompting, full topic guardrailing (only the crisis/medical-symptom safety filter is included), proactive nudges, and multimodal/vision support are all deferred — see `docs/superpowers/specs/2026-08-13-aria-core-extraction-design.md`.
