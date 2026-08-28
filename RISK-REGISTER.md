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

**Description:** The new `GuardrailFilter` (topic off-topic detection) and `SentimentDetector` mechanisms added to `@aria/core` for adapter-fitness operate entirely on adapter-supplied regex/keyword pattern lists — the same class of risk RISK-002 already tracks for `safety-filter.ts`'s crisis patterns. These lists (7 off-topic categories, a wellness-keyword override, 6 sentiment pattern sets) are ported faithfully from real My Body source as of 2026-08-28, but pattern matching has inherent false-negative and false-positive potential, and there is no automated way to detect drift or coverage gaps as real usage accumulates.

**Likelihood:** Medium (hand-maintained keyword/regex lists reliably miss phrasings over time)
**Impact:** Medium (a missed off-topic redirect wastes tokens on an out-of-scope reply; a missed sentiment cue produces a tonally mismatched response — neither is safety-critical the way RISK-002 is, since crisis detection is a separate, earlier-running mechanism)

**Action:** Track false-negative/false-positive reports once a real adapter-fitness consumer exists; consider periodic pattern-list review or a lightweight classifier fallback if manual pattern maintenance proves insufficient.

**Blocking:** Nothing currently (no real consumer yet). Should be reassessed once `@aria/adapter-fitness` or `@aria/adapter-corpflow` has real users.
