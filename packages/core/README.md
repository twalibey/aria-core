# @aria/core

The universal ARIA engine — personality, chat orchestration, rate limiting, tool-use, and safety filtering, decoupled from any single app's domain.

## Security Contract

**This package performs no authentication or authorization.** Every method on `AriaContextProvider`, `AriaHistoryStore`, and every `Tool` handler receives a raw `userId: string` on faith. The consuming app's route layer is responsible for verifying the caller's authenticated session matches `userId` *before* calling `ChatEngine.sendMessage()` or any core interface method directly. Passing an unverified or client-supplied `userId` is a direct cross-user data exposure vulnerability.

Tool handlers must derive all data scope from the `userId` parameter (and, in tenant-scoped mode, the `tenant: TenantContext` parameter) they're called with — never from a field inside `args`, even if a future tool schema is tempted to add one.

### Tenant-scoped mode is opt-in via `SecurityAuditLog`, not a separate flag

`ToolRegistry` has no separate boolean for "tenant-scoped mode." Passing a `SecurityAuditLog` instance as its constructor's second argument turns tenant-scoping enforcement **on**: `execute()` then requires a `TenantContext` on every call (failing the call and logging a `missing_tenant_context` violation if one is missing), and strips-and-logs any LLM-supplied tenant-identity field in `args` (see below). **Omitting `securityAuditLog` silently turns all of this off** — `execute()` will happily run without a `TenantContext` at all. This is a deliberate design choice (opt-in via the audit log, not a redundant boolean you could set inconsistently with it) — not a bug — but it means a consumer building a multi-tenant integration must remember to construct and pass a `SecurityAuditLog` before relying on any tenant enforcement; there is no warning or error if it's left out.

When tenant-scoped mode is on, `ToolRegistry.execute()` also strips any of the known tenant-identity spellings (`tenantId`, `tenant_id`) an LLM-calling tool tries to pass in `args`, logging an `llm_supplied_tenant_id` violation each time, rather than trusting it — the real tenant always comes from the `TenantContext` parameter, never from the tool call arguments.

## Agent Framework

`AgentRunner` orchestrates autonomous agent execution with three configurable autonomy levels, each controlling how far the agent proceeds without human intervention:

- **`off`**: No LLM call at all. The agent does not run; the caller receives immediate feedback that autonomy is disabled.
- **`confirm`**: Draft only, held for human approval. The agent calls the LLM to generate a draft action (e.g., a message or code change) but stops before executing it. A human must review and approve the draft before it is applied.
- **`auto`**: Drafts and executes immediately. The agent calls the LLM to generate a draft action, then executes it without waiting for human approval.

### Claim mechanism and atomicity

Agent execution uses a claim-based concurrency model to ensure that multiple runners do not execute overlapping actions for the same source. `AgentActionStore.claim()` attempts to atomically claim a pending action for execution. For this guarantee to hold at the storage layer, the backing store implementation must enforce a unique constraint on `(sourceType, sourceId, agentId)` — that is, no two rows can have the same combination of source type, source ID, and agent ID. A database-backed store must declare this constraint; an in-memory store must enforce it in its claim logic. **Note this key does not include `tenantId`** — see RISK-008 in the project's `RISK-REGISTER.md` for the resulting (low-probability, UUID-`sourceId`-mitigated) hardening gap, particularly for adapters modeled on `InMemoryAgentActionStore`.

If claim fails (because another runner has already claimed the action), the runner receives an immediate rejection and does not proceed.

### Ground-truthing operational fields with `enrichSnapshot` (added in `v0.5.0`)

`AgentDefinition.enrichSnapshot(input, draft)` is the mandatory pattern for injecting real, non-LLM-derived data into `sourceSnapshot` before it is used or persisted anywhere. The model should never be trusted as the source of truth for operational fields — a recipient address, an amount, a designation, a count — because a hallucination in the drafted prose can otherwise produce a matching hallucination in the very "facts" a human reviewer is relying on to catch it. Every field a consuming app's review UI cross-checks against the drafted content belongs in `enrichSnapshot`'s return value, ground-truthed from `input`, not merely the one field that happens to be security-sensitive. `AgentRunner.run()` calls `enrichSnapshot` immediately after `parseOutput`, and its return value fully replaces `draft.sourceSnapshot` before that snapshot is persisted or handed to `buildToolArgs`.

### `confirmAndExecute`/`reject` tenant ownership (added in `v0.6.0`)

`AgentRunner.confirmAndExecute()` and `AgentRunner.reject()` both fetch the target action and verify its `tenantId` matches the caller-supplied `tenantId` before proceeding. If the action doesn't exist at all, or exists but belongs to a different tenant, both cases fail with the **identical** `AgentAction not found` error — this is intentional: a consumer must not try to distinguish "no such action" from "exists, wrong tenant" upstream, because any such distinction would itself leak cross-tenant existence information (whether some other tenant has an action with that ID) to a caller who should never learn that. A consuming app's route layer should map this error to one generic response either way, not attempt finer-grained handling. See RISK-007 in the project's `RISK-REGISTER.md` for the related gap that neither method additionally guards against being called twice on an already-terminal action (e.g. an action already `sent`) — that guard, where a consumer needs one, is currently the consumer's own responsibility.

### Retry and escalation behavior

`AgentRunner` does **not** retry on its own. On a draft failure, `run()` increments the action's `attemptCount` by one and sets its status to `draft_failed` (or `needs_attention` once `attemptCount` reaches `maxAttempts`) — it then returns, and depends entirely on an external caller (typically a cron job re-invoking `run()` for the same source on its next scheduled tick) choosing to retry. There is no internal retry loop, timer, or backoff inside `AgentRunner` itself. Once an action has escalated to `needs_attention`, `run()`'s claim-time check refuses to re-process it (see "Claim mechanism and atomicity" above) — that escalation is the only thing that's actually automatic; the retries leading up to it are not.

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

### Breaking change in `v0.2.0`: `ResolvedQueryPlan.columns` shape

Between `0.1.0` and `0.2.0`, `ResolvedQueryPlan.columns` changed from `unknown[]` (a bare list of opaque column refs) to `Array<{ key: string; ref: unknown }>` (each resolved ref paired with its caller-facing whitelist key). A bare ref list loses the output column name a runner needs to build a real field-selection map (e.g. `db.select({ [key]: ref, ... })`); without the key, a runner has no way to know what to call the projected column, which is exactly what let the `v0.1.0` `createDrizzleQueryPlanRunner` degrade into an effective `SELECT *` (see `packages/adapter-corpflow/README.md`'s "Behavior change in v0.2.0" note). Any `QueryPlanRunner` implementation written against `0.1.0`'s `columns: unknown[]` shape must be updated to destructure `{ key, ref }` per column before upgrading to `@aria/core@0.2.0`.

## Build Before Test or Typecheck

`@aria/core` resolves through its `exports` map to `packages/core/dist/`, which is gitignored. **The package must be built before anything in the workspace typechecks or runs tests against it**:

```bash
npm run build --workspace=packages/core
```

Root `npm test` and `npm run typecheck` do this automatically via `pretest` / `pretypecheck` scripts, so a clean clone works and a stale `dist` can never silently pass a suite against old source. If you invoke `tsc` or `vitest` **directly** — outside those root scripts — build first yourself, or you will validate the previous build.

## Versioning & Distribution

This package is not published to a registry, and this repo (`aria-core`) is an npm-workspaces monorepo — the repo root itself is **not** installable as a dependency (its `package.json` has no `main`/`exports`, and the real packages live under `packages/*`). Installing `github:twalibey/aria-core#<tag>` directly would clone the whole monorepo root into `node_modules`, which Node cannot resolve anything from.

Instead, each publishable package (`@aria/core`, `@aria/adapter-corpflow`, and any future adapter meant for external consumption) gets its own **per-package release branch**, cut via `git subtree split`, so that package's own directory becomes the root of that branch.

**The first time** a package's release branch is created, `-b` creates it fresh:

```bash
git subtree split --prefix=packages/core -b release-core
git tag core-v0.2.0 release-core
```

**Every subsequent cut** — i.e. every release after the first for a given package — `git subtree split -b <branch>` fails, because that branch name already exists. The actual, real procedure (used to cut every release after the first one, including this project's) is to split into a new commit and re-point the existing branch ref at it with `git branch -f`, then tag that:

```bash
NEW_SPLIT_COMMIT=$(git subtree split --prefix=packages/core)
git branch -f release-core "$NEW_SPLIT_COMMIT"
git tag core-v0.3.0 release-core
```

The same `-b` → `-f` distinction applies to `release-adapter-corpflow` / `adapter-corpflow-vX.Y.Z`.

A consuming app pins each package to its own `<package>-vX.Y.Z` tag, not a shared repo-wide tag:

```json
{
  "dependencies": {
    "@aria/core": "github:twalibey/aria-core#core-v0.2.0",
    "@aria/adapter-corpflow": "github:twalibey/aria-core#adapter-corpflow-v0.2.0"
  }
}
```

Never depend on a floating branch (e.g. `#main` or the raw `#release-core` branch itself) — pin to the tag. A change made for one consuming app would otherwise silently change behavior for every other app pinned the same way. Releases are tagged with semver; a breaking interface change bumps the major version.

Cutting a new release means re-running the subtree split against the desired commit and creating a new tag — this is currently a manual step (a future improvement could script it). **Bumping `core-vX` requires re-cutting and re-pointing `adapter-corpflow-vX` too, even when `adapter-corpflow`'s own code didn't change.** This is now confirmed, not merely likely: this plan's `v0.4.0`, `v0.5.0`, and `v0.6.0` releases each required re-cutting both tags in every case. The mechanism is that `@aria/adapter-corpflow`'s `peerDependencies` (and `devDependencies`) pin a literal `github:twalibey/aria-core#core-vX` URL, and npm resolves a git-URL dependency spec by its exact resolved reference — so `adapter-corpflow`'s own tag must be re-cut with its `@aria/core` pin updated to the new `core-vX` for a consumer to ever see the new `core` version at all. Treat the two release branches as pinned to each other by exact URL, not as independently releasable.

`@aria/adapter-corpflow` declares `@aria/core` as both a `devDependency` (needed to build/typecheck the adapter itself) and a `peerDependency` (npm does not install a dependency's own `devDependencies` for a consumer, but the adapter's emitted `dist/*.d.ts` files still `import type` from `@aria/core` — a consumer typechecking against `@aria/adapter-corpflow` needs `@aria/core` present too, even though no runtime import exists). Consumers installing `@aria/adapter-corpflow` should also install `@aria/core` at a compatible tag.

### Local package.json changes needed for git-tag installs

Any *new* publishable package added to this monorepo in the future must, in its own directory:

- Have a standalone-buildable `tsconfig.json` — inline the shared compiler options directly rather than `"extends"`-ing anything outside the package's own directory (e.g. `../../tsconfig.base.json`). Once the package becomes the root of a subtree-split release branch, nothing outside that directory exists anymore.
- Declare its own build-tool `devDependencies` (e.g. `typescript`, `tsup`) rather than relying on the monorepo root's hoisted versions — a standalone install of just one package won't have those hoisted.
- Add a `"prepare": "npm run build"` script alongside its `build` script — `prepare` is what npm runs automatically right after installing a git dependency, and it's what makes the package self-building on install with no monorepo context required.

Skipping any of these hits the exact resolution failure (`main`/`exports`/`dist` not resolving, or a hoisted-only build tool missing) that this mechanism exists to avoid.

**Known tradeoff: a git-tag cross-dependency between two monorepo siblings doesn't stay live-linked to local edits.** `@aria/adapter-corpflow` depends on `@aria/core` via a literal `github:twalibey/aria-core#core-vX` URL (a `devDependency` + `peerDependency`, not a workspace-compatible semver range like `workspace:*` or `*`). Because that's a real external git reference rather than an in-repo workspace link, `npm install` at the repo root resolves it by fetching that tag from GitHub into `packages/adapter-corpflow/node_modules/@aria/core` — Node's module resolution then finds that nested copy before it would ever walk up to the root-level workspace symlink at `node_modules/@aria/core`. This was confirmed empirically while regenerating the lockfile for this fix wave: after `npm install`, `packages/adapter-corpflow/node_modules/@aria/core` is a real fetched-and-built copy of the `core-v0.2.0` tag, not a symlink to `packages/core`. Practically, this means: **any monorepo package that depends on another monorepo package via a git-tag URL needs that other package's tag re-cut and the dependent's URL updated before local changes to the depended-on package are reflected in the dependent's own tests or build.** Editing `packages/core/src/*.ts` alone does *not* change what `packages/adapter-corpflow`'s own local test run or build sees for `@aria/core` — only a fresh `core-vX` tag pointed at by an updated `adapter-corpflow/package.json` pin does. This is a structural consequence of mixing npm workspaces with git-tag-based external consumption inside the same monorepo, not a bug, and is out of scope to redesign here (e.g. making the same dependency simultaneously workspace-linkable and git-tag-consumable) — just something anyone editing `@aria/core` and expecting `adapter-corpflow`'s local suite to reflect it immediately needs to know.

## Deployment Requirement: Per-App API Keys

Each consuming app should use its own `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY`. Sharing one key across multiple apps means a leak or cost-abuse incident in any single app compromises every other app using that key.

## Non-Goals (Phase 1)

Streaming responses, long-term conversation memory, sentiment-aware prompting, full topic guardrailing (only the crisis/medical-symptom safety filter is included), proactive nudges, and multimodal/vision support are all deferred — see `docs/superpowers/specs/2026-08-13-aria-core-extraction-design.md`.
