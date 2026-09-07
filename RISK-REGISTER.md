# ARIA Risk Register

## RISK-001: No privacy policy or ToS exists for High-tier health data

**Status:** Open
**Filed:** 2026-08-13
**Source:** `privacy-terms-check` pass during Phase 1 design review

**Description:** ARIA collects High-tier personal data (health conditions, medications, pregnancy status, injury history) and transmits it to a third-party LLM provider (OpenRouter, and whichever provider it forwards to) on every chat message. No privacy policy, ToS, or subprocessor disclosure currently exists for this data flow — for either the existing My Body app or this new `@aria/core` package.

**Likelihood:** High (confirmed absent, not assumed)
**Impact:** High (regulatory exposure, loss of user trust, potential legal liability)

**Action:** Draft or have counsel review a privacy policy + ToS covering: what's collected, the LLM subprocessor disclosure, retention period, user deletion rights, and jurisdiction-specific provisions (GDPR/CCPA exposure unconfirmed — target markets not yet stated).

**Blocking:** Any real or beta user being onboarded to any adapter built on `@aria/core`. Not blocking for Phase 1's synthetic-adapter-only work, since no real user data is involved there.

---

## RISK-002: Medical-advice / crisis-redirect rule is prompt-only, unverified

**Status:** Open (partially mitigated — see below)
**Filed:** 2026-08-13
**Source:** `threat-model` + `scope-guard` pass during Phase 1 design review

**Description:** ARIA's "never give medical advice, redirect to a doctor" rule (and implicit crisis-response behavior) exists only as a system-prompt instruction, with no enforcement or verification layer catching the model if it doesn't reliably comply. Users are expected to type distress, pain, or symptom language directly into chat (this is anticipated by the existing fallback-engine keyword list in `ARIA-Reference.md`). This was roadmap gap #9 (Topic Guardrailing), originally deferred in full.

**Likelihood:** Medium (LLMs don't guarantee 100% instruction compliance, especially under ambiguous or crisis-adjacent phrasing)
**Impact:** High (potential harm if a safety-relevant symptom or distress signal isn't reliably redirected)

**Mitigation in progress:** A narrow `safety-filter.ts` module (fail-closed, pre-LLM pattern check for crisis/acute-medical-symptom language) is now in Phase 1 scope, per the Phase 1 design spec. This does not close the risk entirely — pattern matching has false negatives — but establishes a first fail-closed layer instead of relying on the system prompt alone.

**Action:** Track false-negative rate once `safety-filter.ts` is in use; consider a second verification layer (e.g., a lightweight classifier pass) if pattern matching proves insufficient once real usage exists.

**Blocking:** Nothing in Phase 1 (synthetic adapter, no real users). Should be reassessed before Phase 2 (My Body migration) goes live with real users.

---

## RISK-003: Guardrail-category and sentiment-pattern lists are hand-maintained, not exhaustive

**Status:** Open
**Filed:** 2026-08-28
**Source:** `gap-analysis` pass during `@aria/adapter-fitness` design review

**Description:** The new `GuardrailFilter` (topic off-topic detection) and `SentimentDetector` mechanisms added to `@aria/core` for adapter-fitness operate entirely on adapter-supplied regex/keyword pattern lists — the same class of risk RISK-002 already tracks for `safety-filter.ts`'s crisis patterns. These lists (7 off-topic categories, a wellness-keyword override, 6 sentiment pattern sets) are ported faithfully from real My Body source as of 2026-08-28, but pattern matching has inherent false-negative and false-positive potential, and there is no automated way to detect drift or coverage gaps as real usage accumulates. A concrete instance: the wellness-keyword override pattern includes broad terms like "body", "health", "pain", and "energy" that are checked BEFORE the off-topic categories — so a message like "how do I hack my body" bypasses the harmful category entirely via the override. This is faithful to the ported real-source precedence order, and checkSafety (the separate crisis filter) remains the actual safety-critical layer, but it's a concrete example of this risk class worth naming rather than leaving abstract.

**Likelihood:** Medium (hand-maintained keyword/regex lists reliably miss phrasings over time)
**Impact:** Medium (a missed off-topic redirect wastes tokens on an out-of-scope reply; a missed sentiment cue produces a tonally mismatched response — neither is safety-critical the way RISK-002 is, since crisis detection is a separate, earlier-running mechanism)

**Action:** Track false-negative/false-positive reports once a real adapter-fitness consumer exists; consider periodic pattern-list review or a lightweight classifier fallback if manual pattern maintenance proves insufficient.

**Blocking:** Nothing currently (no real consumer yet). Should be reassessed once `@aria/adapter-fitness` or `@aria/adapter-corpflow` has real users.

---

## RISK-004: CorpFlow tenant-scoping layer residual risks

**Status:** Open
**Added:** 2026-08-29 (CorpFlow tenant-scoping layer sub-project)

1. **Indirect prompt injection via legitimately-returned tenant data.** Data a scoped query correctly returns (e.g., a note field) could itself contain text crafted to manipulate the LLM's next action. Only the error-message-leak instantiation is mitigated (raw DB errors never surface); the general case is not solved.
2. **Query whitelist doesn't yet gate on per-tenant module enablement.** A tenant without a given module enabled could still query a globally-whitelisted table backing that module. Expected to be closed by a future progressive-disclosure sub-project.
3. **`resolveActiveDbUser()`'s fallback (CorpFlow's own auth code, not this project's) picks a non-deterministic `users` row when the `active-tenant` cookie is absent/invalid, without using the `isPrimary` flag that exists for this.** Inherited as-is by `TenantContext` (whatever `verifyAuth()` returns is trusted); flagged to CorpFlow's own team as a separate fix, not addressed here.
4. **`SecurityAuditLog` is intended as the same system a future autonomous-agents pillar's audit-trail requirement will extend**, not a separate one.
5. **`createDrizzleQueryPlanRunner`'s fallback path for a malformed query plan (no columns and no aggregation) is silent rather than an error.** `QuerySpecExecutor` doesn't itself reject this shape upstream, so the runner falls back to returning rows containing only a `_tenantId` field. This is safe — no unwhitelisted data leaks — but a caller sees what looks like a successful, if empty-ish, result for a query that should have been rejected outright. Deferred, not fixed.
6. ~~**The query-plan runner's tests are entirely mock-based**, asserting on the shape of calls made against a mocked Drizzle query builder, with no test that runs a plan through a real Drizzle builder out to `.toSQL()` to check the actual generated SQL. This is precisely the class of gap that let the original v0.1.0 defect (whitelist-validated columns/aggregation/sort/limit all silently discarded, degrading every query to an uncapped `SELECT *`) ship undetected by its own task's test suite. A real SQL-rendering test is recommended follow-up work, not yet built.~~ **Resolved** (final-review fix wave, 2026-08-30): `packages/adapter-corpflow/test/query-spec-executor-integration.test.ts` now runs a real `QuerySpecExecutor` + real `createDrizzleQueryPlanRunner` against a real `drizzle-orm` pg-core table (via the `drizzle-orm/pg-proxy` driver, which captures the actual compiled SQL string and bound params instead of hitting a live connection), for both a plain column-selection descriptor and an `avg` aggregation descriptor.
7. **The `count` aggregation is implemented as `count(<column>)` (count of non-null values in that column), not `count(*)` (count of rows).** This is equivalent for a non-nullable column, which covers every `count`-eligible column in the current 8-table whitelist, but would silently undercount if the whitelist is later extended to a nullable column. Worth flagging to whoever extends the whitelist next.
8. **The Slack alert fired on a tenant-scoping violation has no severity tiering.** An ordinary LLM mistake (e.g., requesting a non-whitelisted column by typo) pages the team with the same urgency as a genuine attempted cross-tenant access attempt. This is a real alert-fatigue risk — enough low-severity noise could cause a real violation to get missed or dismissed. Deferred, not fixed.

**Recommended, not built:** fixing CorpFlow's DB connection to use a non-superuser, per-request-scoped role with `FORCE ROW LEVEL SECURITY`, for true defense-in-depth.

---

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

## RISK-006: live-donor-response-agent-smoke-test.ts duplicates donor-response.ts logic with no drift detection

**Status:** Open
**Filed:** 2026-08-31
**Source:** Task 15 review of the CorpFlow autonomous-agents plan

**Description:** The smoke-test script at `packages/adapter-corpflow/scripts/live-donor-response-agent-smoke-test.ts` hand-copies `buildPrompt`, `ordinalSuffix`, and `parseOutput` logic from the real `src/lib/agents/donor-response.ts` in CorpFlow's separate repository. This duplication is unavoidable across the repo boundary (the script cannot import from a different repo), but it creates a drift risk: if `donor-response.ts`'s prompt or parsing logic changes, this script continues compiling and "passing" while silently testing stale behavior. The script is excluded from typecheck (same as its predecessor) and never runs in CI (requires a live API key), leaving only an in-script code comment as a drift guard — nothing forces anyone to read it before relying on the script's results.

**Likelihood:** Medium (any future edit to `donor-response.ts`'s prompt or parser logic risks this drifting silently)
**Impact:** Low-Medium (a stale smoke test gives false confidence; the real production code path is unaffected)

**Action:** Before next relying on this script's results, diff it against the real `donor-response.ts` to confirm the copied logic still matches. Consider whether a future refactor could extract the shared prompt/parse logic into something both repos can import (not in scope for this plan).

**Blocking:** Not blocking this plan. Worth addressing before this script is trusted again after any future change to `donor-response.ts`.

---

## RISK-007: `AgentRunner.confirmAndExecute()`/`reject()` have no server-side idempotency guard against a double call on an already-terminal action

**Status:** Open
**Filed:** 2026-08-31
**Source:** Final whole-branch review of the CorpFlow autonomous-agents plan, fix wave

**Description:** `@aria/core`'s `AgentRunner.confirmAndExecute()` and `reject()` fetch the action, verify its `tenantId` matches the caller, and then unconditionally act — neither method checks the action's current `status` before proceeding. Calling either twice in quick succession (e.g. a double-click, a retried request after a slow response, or two racing requests) on an already-terminal action (`sent`, `auto_sent`, `edited_and_sent`, `rejected`) has no guard at the framework level. This wave's Fix I-3 adds a CorpFlow-route-level precondition (fetch the action, check `status`/`agentId` before calling `confirmAndExecute`/`reject`, return 409 if the transition isn't valid) that substantially mitigates this for the two CorpFlow routes it covers, but that fix lives in CorpFlow's route layer, not in `@aria/core` itself — the underlying framework method still has no such guard for any future consumer (a different adapter, a different route, a background job) that calls `confirmAndExecute`/`reject` directly without adding the same precondition itself.

**Likelihood:** Low-Medium (requires a double-call race — a slow first request plus a retry, or two staff members acting on the same row near-simultaneously — but nothing prevents it at the framework level)
**Impact:** Medium (a double `confirmAndExecute` could attempt to send a donor email twice; a double `reject` on an already-`sent` action would silently overwrite the record of a real email that went out — the exact corruption scenario Fix I-3 exists to prevent, just reachable again by any future consumer that doesn't replicate Fix I-3's route-level check)

**Action:** Consider adding a status-transition guard directly inside `AgentRunner.confirmAndExecute()`/`reject()` in a future `@aria/core` minor version, so this protection is structural rather than something every consumer must remember to re-implement at its own route layer.

**Blocking:** Not blocking this plan (Fix I-3 covers the two routes CorpFlow ships today). Should be revisited before any future adapter or route calls `confirmAndExecute`/`reject` without its own equivalent precondition check.

**Amendment, 2026-09-06 (CorpFlow automation-builder / Pillar 4 design, alignment-analysis):** Pillar 4's `notify_case_owner` action tool adds a second exposure surface — a check-before-send idempotency key `(case_id, assignee_id, definition_id)` at the tool level, checked before an action is allowed to send. This reduces but does not close this risk: two concurrent `confirmAndExecute` calls on the same draft can both pass the tool-level check before either sends (check-then-act race), since the underlying framework method still has no atomic guard. Deliberately deferred rather than fixed as part of Pillar 4, per explicit user decision, to keep that pillar's scope contained — but Pillar 4 is now a second real consumer that needs this closed properly, raising the priority of the underlying `Action` above.

---

## RISK-008: `AgentActionStore.claim()`'s conflict/claim key omits `tenantId`

**Status:** Open, low-priority hardening item
**Filed:** 2026-08-31
**Source:** Final whole-branch review of the CorpFlow autonomous-agents plan, fix wave

**Description:** Both `InMemoryAgentActionStore`'s claim-index key and `createDrizzleAgentActionStore`'s `onConflictDoNothing` target are `(sourceType, sourceId, agentId)` only — `tenantId` is not part of either uniqueness key. In practice this is not exploitable today: `sourceId` values are UUIDs, so a genuine cross-tenant collision on `(sourceType, sourceId, agentId)` has effectively nil real-world probability, and the production `createDrizzleAgentActionStore` path only turns a collision into a denial (the conflicting insert is silently dropped, `claim()` returns null) rather than a bypass of any tenant boundary. The real gap is in the in-memory reference store: `InMemoryAgentActionStore` is intended as a template for future adapter authors, and its claim logic bypasses on a rare `attemptCount > 0` collision rather than uniformly denying — a future adapter built by copying this reference implementation, for a domain where `sourceId` is not guaranteed globally unique across tenants (e.g. a sequential per-tenant ID rather than a UUID), could inherit a real cross-tenant claim collision.

**Likelihood:** Low (requires both: a future adapter using non-globally-unique `sourceId` values, and copying `InMemoryAgentActionStore`'s bypass-on-retry behavior verbatim into a production path)
**Impact:** Low-Medium (a claim collision under those conditions could let one tenant's retry bypass another tenant's already-claimed action row in the affected adapter — not a data-read leak, but an incorrect claim state)

**Action:** Add `tenantId` to both the in-memory claim-index key and the Drizzle store's `onConflictDoNothing` target in a future `@aria/core` minor version, closing the gap structurally rather than relying on UUID `sourceId` values as an implicit mitigation every future adapter must independently understand.

**Blocking:** Not blocking this plan. Worth closing before a future adapter with non-UUID `sourceId` values is built against either store implementation.

---

## RISK-009: `ToolRegistry`'s `SecurityAuditLog` wiring is optional, not structurally enforced

**Status:** Open
**Filed:** 2026-09-06
**Source:** Alignment-analysis pass during the CorpFlow automation-builder (Pillar 4) design, verified against real code via investigation subagent

**Description:** `@aria/core`'s `ToolRegistry` constructor (`packages/core/src/tools.ts:23-26`) takes `securityAuditLog` as an optional parameter with no default enforcement. The autonomous-agents pillar's final review already found all 3 real `ToolRegistry` instances (`approve/route.ts`, `reject/route.ts`, `cron/[job]/route.ts`) had been built without it wired in, and fixed each instance individually — but the constructor itself was never changed to make omission impossible. Those two routes are hardcoded to `donorResponseAgentDefinition` and cannot be reused as-is for Pillar 4's automation actions; a new or generalized approve/reject path is required, and nothing in `ToolRegistry`'s type signature would catch that new path silently omitting the audit log the same way the original 3 nearly did.

**Sharper than originally filed (confirmed 2026-09-06, planning-stage investigation for Pillar 4):** `ToolRegistry.execute()`'s entire tenant-context enforcement block — the missing-tenant-context check and the LLM-supplied-tenant-id stripping — is gated inside `if (this.securityAuditLog)` (`tools.ts:54`). Omitting `securityAuditLog` doesn't just disable audit logging; it disables tenant-scoping enforcement itself for every tool call routed through that instance. This is a real vulnerability class, not a logging gap — reclassified accordingly below.

**Likelihood:** Medium (a second, independently-built route is now planned; the same class of omission has already happened once)
**Impact:** Critical (an unaudited `ToolRegistry` instance doesn't just lose its audit trail — it silently drops tenant-scoping enforcement for every tool call it routes, the exact vulnerability class this project's CorpFlow pivot exists to close)

**Action:** Make `securityAuditLog` a required constructor parameter (no default) in a future `@aria/core` minor version, so this is structural rather than a convention every new route must remember — planned as part of Pillar 4's implementation, since it's the pillar creating the next `ToolRegistry`-adjacent route.

**Blocking:** Blocking for Pillar 4's new approve/reject-equivalent route — must be fixed before or alongside that route's construction, not deferred past it.

**Update (2026-09-06):** Core-side fix landed in `@aria/core` commit `3a10d50` (required `securityAuditLog` + explicit `tenantScoped` flag); status stays Open until Task 7's version bump/repin lands so CorpFlow's actual runtime picks it up.

---

## RISK-011: `InMemoryAgentActionStore.claim()` conflates claim-vs-retry semantics, making `AgentRunner.run()`'s reclaim fallback unreachable against it

**Status:** Open
**Filed:** 2026-09-06
**Source:** Task reviewer, Task 2 of the CorpFlow automation-builder plan (subagent-driven-development execution)

**Description:** `InMemoryAgentActionStore.claim()` returns an existing row directly (instead of `null`) whenever `status !== 'needs_attention' && attemptCount > 0` — a condition every `draft_failed` row satisfies, since `handleDraftFailure` always increments `attemptCount` to at least 1 before setting that status. `AgentRunner.run()`'s new reclaim fallback (added this same task) only calls `reclaimForRetry` when `claim()` returns `null`, and `reclaimForRetry` only succeeds on a `draft_failed` row — two conditions that can never both hold against this store. The fallback is therefore unreachable/dead code against `InMemoryAgentActionStore` in any organic `run()` sequence; it is only proven correct via a hand-rolled fake store in Task 2's own unit test, not any real store.

**Not a production risk today:** the real `createDrizzleAgentActionStore.claim()` uses `onConflictDoNothing`, a true insert-or-null semantic that returns `null` for any existing row regardless of status — so CorpFlow's actual trigger-detection path (and its real-Postgres retry-sweep test) correctly exercises the fallback. This is a reference-implementation/test-coverage gap in `@aria/core`'s own in-memory store, not a live bug.

**Likelihood:** Low impact today (no production consumer affected); the gap persists as long as `InMemoryAgentActionStore` is used to test any future `reclaimForRetry`-dependent behavior.
**Impact:** Low (coverage gap only) today; would become Medium if a future adapter modeled its own claim() on this store's leniency instead of a true insert-or-null semantic, repeating the same unreachable-fallback shape in a real store.

**Action:** Change `InMemoryAgentActionStore.claim()` to true insert-or-null semantics (return `null` for any existing row, regardless of status/attemptCount), moving all retry-allowance logic exclusively into `reclaimForRetry`. Audit existing consumers (e.g. `@aria/adapter-example`'s tests) for any reliance on the current lenient behavior before making this change, since its blast radius on pre-existing tests is unaudited.

**Blocking:** Not blocking the CorpFlow automation-builder plan — parked during Task 2's review rather than reopening already-merged Task 1 work.

---

## RISK-012: A bare `npm install` at the repo root fails in a genuinely fresh clone (monorepo workspace build-ordering)

**Status:** Resolved (2026-09-06, commit `e17f46f`)
**Filed:** 2026-09-06
**Source:** Task 7 (CorpFlow automation-builder plan) standalone build verification — diagnosed while bumping `@aria/adapter-corpflow` to 0.8.0 and repinning its `@aria/core` dependency to resolve via the local workspace instead of a stale external git tag.

**Description:** A brand-new clone of this repo, followed by a plain `npm install` with no flags, fails. Symptom:

```
src/agent-action-store.ts(2,52): error TS7016: Could not find a declaration file for module '@aria/core'. '.../packages/core/dist/index.js' implicitly has an 'any' type.
src/agent-action-store.ts(73,17): error TS7006: Parameter 'params' implicitly has an 'any' type.
... (several more TS7006/TS7016 in agent-action-store.ts and query-plan-runner.ts)
npm error Lifecycle script `build` failed with error:
npm error workspace @aria/adapter-corpflow@0.8.0
```

Root cause: `npm install` automatically runs each workspace member's own `prepare` script (both `packages/core` and `packages/adapter-corpflow` have `"prepare": "npm run build"`, needed so a real external git-tag install produces a working `dist/`). npm processes workspace members' `prepare` scripts in alphabetical directory order, not true dependency order — `packages/adapter-corpflow` always runs before `packages/core`. Until Task 7's repin (this same task), `adapter-corpflow`'s `@aria/core` dependency was a real external git tag, so its build never actually needed `packages/core`'s local `dist/` to exist — this bug was latent, not yet exercised. Task 7 correctly repinned `adapter-corpflow`'s `@aria/core` dependency to resolve via the local workspace (necessary to fix a different, real defect — see the Task 7 report), which means `adapter-corpflow`'s build now genuinely depends on `packages/core`'s `dist/` existing first. On a fresh clone, it doesn't yet, so `tsc` resolves `@aria/core`'s exports with no type declarations at all (implicit `any`, `skipLibCheck` doesn't save it) and later `strict`-mode checks on the now-`any`-typed parameters fail.

Confirmed reproducible in a disposable throwaway clone, deleted after diagnosis. Also confirmed the *explicit* `npm run build` script does not hit this (a `prebuild` hook added in the same Task 7 commit forces `packages/core` to build first for that script, mirroring the pre-existing `pretest`/`pretypecheck` pattern) — this defect is specific to the implicit `prepare`-during-`npm install` path, which the `prebuild` hook cannot reach.

**Verified workaround:** `npm install --ignore-scripts && npm run build && npm test` — skips the redundant, mis-ordered per-workspace `prepare`-time build (harmless to skip locally; the subsequent explicit `npm run build`, correctly ordered via `prebuild`, builds everything anyway) and confirmed clean (37/37 test files, 271/271 tests) in a fresh clone.

**Correction (2026-09-06, same-day hotfix):** This entry's original "Why not fixed here" reasoning and its "Impact: Low-Medium... does not affect real external consumption" line were wrong. Verifying Task 7's work against a real consumer (repinning a live CorpFlow checkout to `adapter-corpflow-v0.8.0`/`core-v0.8.0` and doing a clean `rm -rf node_modules package-lock.json && npm install`) reproduced this exact TS7016/TS7006 failure for real, external, git-tag consumption — not just the monorepo's own from-scratch local setup. The premise that "no `../core` sibling directory exists at all" during a real git-tag install was factually incorrect: npm's git-dependency mechanism clones the *entire* monorepo (it has to, since the whole repo is needed to resolve which workspace member matches the requested package name and to run that workspace's own lifecycle scripts), so `packages/core` genuinely is present as a sibling directory during a real external install, exactly as it is in a local monorepo clone.

**Root cause confirmed via `npm`/`pacote` source (`pacote/lib/git.js#L160-198`):** for a git dependency whose resolved manifest declares `workspaces` (true for this repo's root), pacote runs a nested `npm install` inside the freshly-cloned repo, which triggers every workspace member's own `prepare` script. These run with no guaranteed ordering against each other (confirmed via `--loglevel silly`: `@aria/adapter-corpflow@0.8.0 prepare` and `@aria/core@0.8.0 prepare` were dispatched concurrently, not in strict alphabetical order as originally assumed) — a race, not a deterministic sequence. The root-level `prebuild` hook (Task 7) never runs in this path at all, since it belongs to the *root* `package.json`, which npm's internal git-dep preparation never invokes as an npm script — it only runs each workspace member's own scripts directly.

**Fix:** `packages/adapter-corpflow/package.json`'s `prepare` script was changed from `"npm run build"` to `"npm run build --prefix ../core && npm run build"`, making it build `packages/core` itself before its own build/typecheck step, deterministically, regardless of what order or context it runs in. (The originally-proposed `npm run build --workspace=packages/core --if-present` does **not** work in this context — `--workspace` addressing requires npm's cwd to already be the monorepo root and does not walk up to find one from within a workspace member's own directory; `--prefix ../core` uses a plain relative path instead and needs no such resolution, so it works correctly from both the monorepo root and from `packages/adapter-corpflow`'s own directory.) See commit `e17f46f` (`fix(adapter-corpflow): make prepare self-sufficient for git-tag installs`).

**Verified:** A real `npm install` against the actual pushed `github:twalibey/aria-core#adapter-corpflow-v0.8.0` / `#core-v0.8.0` tags (pre-fix) reproduces the exact TS7016/TS7006 crash from a scratch consumer project. Cloning this repo at the fix commit and installing it as a git dependency of a scratch consumer project (via `git+file://...#<tag>::path:<package>`, mimicking npm's real git-tag install mechanism) completes with zero errors post-fix, where it previously failed. Full workspace `build`/`test` (271/271 tests) still pass with no regression; the one pre-existing `typecheck` failure (`AgentActionStore` missing `reclaimForRetry` in a test file) reproduces identically on the pre-fix commit and is unrelated to this change (tracked separately, see RISK-011 territory).

**New, separate finding — see RISK-013:** verifying this fix surfaced a second, deeper, previously-unknown issue: even after a git dependency's `prepare` succeeds, the final content npm places under `node_modules/<name>` for a package requested from inside this monorepo appears to be the *entire monorepo root*, not the matched workspace subdirectory — which would break `require`/`import` of `@aria/adapter-corpflow` or `@aria/core` at runtime even after a clean `npm install`. This was not previously exercised because no real CorpFlow code path yet imports these packages (Pillar 4 is still mid-development). This is **not** fixed by this hotfix and needs its own dedicated investigation before Pillar 4 code starts relying on these imports for real.

**Likelihood:** High (this is the default, unmodified command a new contributor, CI job, *or real external git-tag consumer* would run; it failed 100% of the time, not intermittently)
**Impact (as originally filed, before correction): Low-Medium.** **Actual impact: Critical** — this blocked real external consumption of the already-pushed `adapter-corpflow-v0.8.0`/`core-v0.8.0` tags via `npm install`, not just this monorepo's own from-scratch local setup.

**Action:** Done — see Fix above. `packages/adapter-example` and `packages/adapter-fitness` were checked and confirmed to need no equivalent change: neither declares a `build`/`prepare` script at all (`main` points directly at `src/index.ts`), and neither is consumed via git-tag install by any external project — both are purely in-repo reference implementations.

**Blocking:** No longer blocking — real external git-tag consumption (CorpFlow) is unblocked as of commit `e17f46f`. See RISK-013 for the separate, still-open final-placement concern this verification surfaced.

---

## RISK-013: `core-v0.8.0`/`adapter-corpflow-v0.8.0` (and the `v0.8.1` hotfix) were never subtree-split — both are non-functional for real external consumption

**Status:** Resolved (2026-09-07), superseded by properly subtree-split `v0.8.2` tags
**Filed:** 2026-09-07
**Source:** Verifying RISK-012's fix end-to-end: a real `npm install` of `@aria/adapter-corpflow`/`@aria/core` against the pushed `github:twalibey/aria-core#adapter-corpflow-v0.8.1`/`#core-v0.8.1` tags into CorpFlow's own checkout, followed by `node -e "require.resolve('@aria/adapter-corpflow')"`.

**Description:** `npm install` completed with zero errors, but `require.resolve('@aria/adapter-corpflow')` failed outright (`Cannot find module`). Inspecting `node_modules/@aria/adapter-corpflow` showed it held the **entire monorepo root** (`ARIA-Reference.md`, `RISK-REGISTER.md`, `docs/`, `packages/`, root `tsconfig*.json`) — its `package.json`'s `"name"` field was `"aria"` (the monorepo root's own name), with no `main`/`module`/`exports` field and no `dist/` at that level (the real built output was two directories deeper, at `packages/adapter-corpflow/dist`, which node's resolution never looks for).

**Root cause confirmed against this repo's own documented process** (`packages/core/README.md`, "Versioning & Distribution"): every publishable package tag is required to be cut via `git subtree split --prefix=packages/<name>`, re-pointing a dedicated `release-<name>` branch, so that package's own directory becomes the *root* of the tagged tree — confirmed by inspecting `adapter-corpflow-v0.7.0`'s tree (correctly just `package.json`/`src/`/`test/`/etc., no monorepo wrapper). **Both `core-v0.8.0`/`adapter-corpflow-v0.8.0` (cut in the prior session) and the `v0.8.1` hotfix (cut this session) skipped this step entirely** — both are plain tags directly on the monorepo commit. `release-core`/`release-adapter-corpflow` were left untouched at their `v0.7.0` state the whole time. This was invisible to every check run so far (standalone monorepo build, `npm test`, even the RISK-012 fix's own "real npm install completes" check) because none of them call `require.resolve` or actually import the installed package — this project's [[feedback_verify_git_tags_with_standalone_build]] memory already lists 4 classes of tag-cutting defect invisible to a standalone build; this is a 5th, and the most basic one (the subtree-split step being skipped outright, despite being documented), not a new mechanism.

**Fix:** Re-did the release correctly as `v0.8.2` — real `git subtree split --prefix=packages/core` / `--prefix=packages/adapter-corpflow`, `git branch -f release-core`/`release-adapter-corpflow` re-pointed at the new split commits, tagged from those branches (not the monorepo commit). `v0.8.0` and `v0.8.1` are left in place, undeleted (already pushed, per this project's own convention against rewriting a published tag), but are now documented here as **non-functional for real external consumption** — do not point any consumer at either.

**Verified:** repinned CorpFlow's own checkout to `core-v0.8.2`/`adapter-corpflow-v0.8.2`, did a clean `rm -rf node_modules package-lock.json && npm install`, and confirmed both `node_modules/@aria/core/package.json` and `node_modules/@aria/adapter-corpflow/package.json` have the correct package `name` (not `"aria"`) and that `require.resolve('@aria/adapter-corpflow')` and `require.resolve('@aria/core')` both succeed and point at real `dist/` files.

**Likelihood:** Was High — 100% reproducible for any real external consumer of `v0.8.0`/`v0.8.1`.
**Impact:** Was Critical (broke all real external consumption of both packages) — now Resolved for `v0.8.2` onward.

**Action:** Done — see Fix/Verified above. Process gap worth closing separately: nothing currently *checks* that a cut tag was actually subtree-split before it's pushed — the verification memory's standalone-build step should be extended to include a `require.resolve` (or equivalent real-import) smoke test, not just "build succeeds," and ideally a pre-push assertion that a package's tag tree doesn't contain files outside that package's own directory (e.g. no `RISK-REGISTER.md`/`docs/` at tag root). Not filed as its own risk-register entry — this is tooling/process hardening, tracked here as a follow-up note instead.

**Blocking:** No longer blocking — resolved via `v0.8.2`.

---

## Standing Process Rules

Cross-pillar process requirements, distinct from the numbered security/compliance risks above — apply to every future pillar, not just the one that surfaced them.

### PROC-001: Every new UI surface must be linked into real product navigation before a pillar is considered done

**Added:** 2026-09-06, promoted from a per-pillar reminder after recurring across two pillars

**Description:** The autonomous-agents pillar (Pillar 3) shipped a queue page that was never linked into CorpFlow's actual navigation — a real defect caught only at final review. Pillar 4's original design explicitly promised not to repeat this, but its own alignment-analysis found that promise covered only one of the three new UI surfaces the pillar actually introduces (creation/preview flow, automation management list, per-automation autonomy toggle). Restating the discipline pillar-by-pillar has now failed once and needed reinforcement once — it does not reliably self-correct as a per-pillar reminder.

**Rule:** Before any pillar (or any future feature with a UI component) is marked done, every new UI surface it introduces must be explicitly enumerated and confirmed linked into the product's real navigation — not just built and reachable by direct URL. This check belongs in that work's own Definition of Done, and in whatever review closes it out (task review or final whole-branch review), not left to be remembered freshly each time.

**Blocking:** Applies going forward to every pillar/feature with a UI component, starting with Pillar 4.

---
