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

## Standing Process Rules

Cross-pillar process requirements, distinct from the numbered security/compliance risks above — apply to every future pillar, not just the one that surfaced them.

### PROC-001: Every new UI surface must be linked into real product navigation before a pillar is considered done

**Added:** 2026-09-06, promoted from a per-pillar reminder after recurring across two pillars

**Description:** The autonomous-agents pillar (Pillar 3) shipped a queue page that was never linked into CorpFlow's actual navigation — a real defect caught only at final review. Pillar 4's original design explicitly promised not to repeat this, but its own alignment-analysis found that promise covered only one of the three new UI surfaces the pillar actually introduces (creation/preview flow, automation management list, per-automation autonomy toggle). Restating the discipline pillar-by-pillar has now failed once and needed reinforcement once — it does not reliably self-correct as a per-pillar reminder.

**Rule:** Before any pillar (or any future feature with a UI component) is marked done, every new UI surface it introduces must be explicitly enumerated and confirmed linked into the product's real navigation — not just built and reachable by direct URL. This check belongs in that work's own Definition of Done, and in whatever review closes it out (task review or final whole-branch review), not left to be remembered freshly each time.

**Blocking:** Applies going forward to every pillar/feature with a UI component, starting with Pillar 4.

---
