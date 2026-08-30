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
6. **The query-plan runner's tests are entirely mock-based**, asserting on the shape of calls made against a mocked Drizzle query builder, with no test that runs a plan through a real Drizzle builder out to `.toSQL()` to check the actual generated SQL. This is precisely the class of gap that let the original v0.1.0 defect (whitelist-validated columns/aggregation/sort/limit all silently discarded, degrading every query to an uncapped `SELECT *`) ship undetected by its own task's test suite. A real SQL-rendering test is recommended follow-up work, not yet built.
7. **The `count` aggregation is implemented as `count(<column>)` (count of non-null values in that column), not `count(*)` (count of rows).** This is equivalent for a non-nullable column, which covers every `count`-eligible column in the current 8-table whitelist, but would silently undercount if the whitelist is later extended to a nullable column. Worth flagging to whoever extends the whitelist next.
8. **The Slack alert fired on a tenant-scoping violation has no severity tiering.** An ordinary LLM mistake (e.g., requesting a non-whitelisted column by typo) pages the team with the same urgency as a genuine attempted cross-tenant access attempt. This is a real alert-fatigue risk — enough low-severity noise could cause a real violation to get missed or dismissed. Deferred, not fixed.

**Recommended, not built:** fixing CorpFlow's DB connection to use a non-superuser, per-request-scoped role with `FORCE ROW LEVEL SECURITY`, for true defense-in-depth.
