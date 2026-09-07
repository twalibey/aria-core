# CorpFlow Automation Builder — Design Spec (Pillar 4)

## What This Is

The fourth of CorpFlow's four planned ARIA pillars ([[project_corpflow_second_adapter_pivot]]), designed and built ahead of Pillar 2 (cross-module Q&A) per the user's own priority call — no technical dependency forced this order. The brief asked for "plain-English automation building": a user describes an automation in plain language, ARIA proposes it in terms of modules/fields/events, shows a preview before going live, and everything it builds respects the same tenant-isolation/role-permission rules as a human-built automation.

This spec builds a real, minimal execution engine by extending `@aria/core`'s existing `AgentRunner`/`ToolRegistry`/audit-log machinery — not by reviving CorpFlow's dead `automation_rules` schema, and not by building a fourth parallel automation system alongside the two that already exist and don't run.

**V1 concrete target** (mirroring how Pillar 3 narrowed from an abstract "Lead-Response Agent" to one real Donor Response Agent): **case created → notify the assigned staff member via the existing in-app notification system, falling back to `notifyStaff()` broadly if unassigned.**

## Investigation Findings (grounding this design in real code, not the pasted brief)

- CorpFlow has **no real automation execution anywhere for anyone**: the "Automation Rule Designer" UI is honestly labeled "Preview — does not currently run"; a second, separately-scoped FlowSpace automation builder has a fully-written executor (`runAutomations()`) never invoked from anywhere; no internal event bus exists; every business event is only ever detected by whichever single API route writes that row.
- `20260819_remove_dead_trigger_vocabularies.sql` had already removed two of three historically-competing, always-dead trigger vocabularies before this design started.
- Real notification infrastructure exists: a working Resend-backed `sendEmail()` (already used for several transactional emails), a real but single-global-channel Slack integration (per-tenant Slack DB fields exist but are dead/unused), and — the best v1 fit — a fully-wired in-app notification system (`notifications` table + header bell UI, already supporting `resourceType: "case"`).
- `cases.assignedToId` (nullable) is the real "case owner" field.
- The Donor Response Agent's real polling cron (`runDonorResponseAgentJob`) does an INNER JOIN against `tenantAgentSettings` on a single fixed `agentId = "donor-response"` — clean because there is exactly one global agent to join against. This pillar has no such single fixed ID (see Trigger Detection below).
- `@aria/core`'s `ToolRegistry` constructor (`packages/core/src/tools.ts:23-26`) takes `securityAuditLog` as optional with no enforced default. Pillar 3's final review found all 3 real instances had been built without it wired in and fixed each one individually, but the constructor itself was never changed to make omission impossible. CorpFlow's `approve/route.ts` and `reject/route.ts` are hardcoded to `donorResponseAgentDefinition` and cannot be reused as-is for this pillar's automation actions.
- **Sharper than previously known:** `ToolRegistry.execute()`'s entire tenant-context enforcement block — the missing-tenant-context check and the LLM-supplied-tenant-id stripping — is gated inside `if (this.securityAuditLog)` (`tools.ts:54`). Omitting `securityAuditLog` from a `ToolRegistry` instance doesn't just disable audit logging; it disables the tenant-scoping enforcement itself for every tool routed through that instance. All 3 current instances pass it correctly today, so nothing is live-exploitable now, but this raises `RISK-009`'s real severity from "audit trail silently disabled" to "tenant enforcement silently disabled" — see the amended `RISK-009` below.
- **New finding, changes the retry design:** `createDrizzleAgentActionStore.claim()` (`packages/adapter-corpflow/src/agent-action-store.ts:73-87`) uses `onConflictDoNothing({ target: [sourceType, sourceId, agentId] })` with no reclaim path at all — if a row already exists for that triple, in ANY status, the insert conflicts and `claim()` returns `null`, unconditionally. The in-memory store's reclaim-on-`attemptCount > 0` logic was never ported to the real Drizzle store. This means fixing only the cron job's candidate-selection query (to also select `draft_failed` rows) would not enable retry in production — `AgentRunner.run()` would call `claim()`, get `null`, and skip every time regardless. A real `AgentActionStore` interface addition is required (see Core Additions).

## Design Decisions (approved)

1. Build a real (minimal) execution engine as part of this pillar by extending `@aria/core`'s existing `AgentRunner`/`ToolRegistry`/audit-log machinery, rather than reviving the dead `automation_rules` schema or building a 4th parallel system.
2. Core mechanism: add one new optional `AgentDefinition.buildDraft?(input): AgentDraftOutput`. When present, `AgentRunner.run()` skips `buildPrompt`/LLM-call/`parseOutput` entirely and uses it directly — fully additive/backward-compatible; the shipped Donor Response Agent (no `buildDraft`) is completely unaffected.
3. Trigger detection: polling, reusing the pattern already proven by the Donor Response Agent, deliberately designed behind a small "event source" seam so a future real event bus (if Pillar 2 or something else ever gives it a second real consumer) is a swap at that seam, not a rewrite. Explicitly not building a general event bus now — one real consumer exists today, and this project has already made the mistake once (dead trigger vocabularies, FlowSpace's never-invoked executor) of building generalized-but-unused mechanisms.
4. Data model: new `automation_definitions` table (not reviving the dead schema); per-automation autonomy via a synthetic `agent_id` (`automation:{definitionId}`) reusing the existing `tenant_agent_settings` table as-is — zero core schema change for independent off/confirm/auto per automation.
5. NL → validated descriptor mirrors `QuerySpecExecutor`'s proven pattern (LLM proposes, server validates against a typed whitelist — v1 whitelist has exactly one entry: event `case_created`, action `notify_case_owner`). Nothing persists until the user confirms a plain-English preview. New automations default to `confirm` autonomy, not `auto`.
6. CorpFlow's two existing dead/inconsistent automation UIs are left completely untouched — flagged explicitly as a known, pre-existing, out-of-scope gap, not folded into this pillar.

## Gap-Analysis Resolutions (sections 1-2, read against real code)

Read `agent-types.ts`, `agent-runner.ts`, `agent-action-store-in-memory.ts`, and adapter-corpflow's `agent-action-store.ts` directly rather than trusting a design summary. Found and resolved 7 real gaps:

1. **(High) A real bug in already-shipped code:** the Donor Response Agent's real polling cron never actually retries a `draft_failed` row — its candidate-selection query structurally excludes any source with an existing `agent_actions` row (`.where(and(isNull(agentActions.id), ...))`), so the in-memory store's retry-reclaim logic is dead code in production. **Corrected during planning-stage investigation (2026-09-06):** the fix is deeper than a query change — `createDrizzleAgentActionStore.claim()` has no reclaim path at all (see Investigation Findings), so retry requires a real `AgentActionStore` interface addition, not just a different candidate-selection query. Resolved (for this new automation, not retroactively for donor-response): a new `reclaimForRetry` method is added to `AgentActionStore` and implemented in both stores; the trigger-detection query selects retry candidates separately from new candidates and calls the new method for the former (see Trigger Detection and Core Additions).
2. **(Medium)** No cascade/deletion semantics → soft-delete only (`is_active = false`), never hard-deleted.
3. **(Medium)** `automation_definitions.id` (basis of the synthetic `agent_id`) assumed-but-unstated immutable → locked in as a written invariant.
4. **(Medium)** Editing a live automation's `trigger_event`/`action_type` would silently shift the meaning of its accumulated audit history → both become immutable after creation; only `name`/`condition`/`action_config`/`is_active` are editable.
5. **(Medium)** No stated permission model → `admin`/`manager`/`super_admin` only, matching the existing `requireRole` pattern (same gate for approve/reject).
6. **(Low)** Untyped `jsonb` write contract → locked in as validated-pipeline-only: no row is ever written except through the validated NL→descriptor pipeline.
7. **(Low)** No per-tenant automation cap → added, 20 active per tenant, enforced at creation.

## Red-Team Resolutions (sections 3-6)

1. **Whitelist-of-one UX.** In-product framing shows "Automations available today" alongside the free-text input, so the NL feature isn't sold as unbounded. On whitelist-validation failure, the response is a fixed, sanitized message ("I can't build that yet — here's what I can build today: [...]") — never raw validator error text, extending `QuerySpecExecutor`'s existing "no raw error to the user" principle to this pillar explicitly. The LLM's prompt includes the whitelist's plain-English descriptions so it can respond conversationally to a mismatch; server-side whitelist validation remains the actual gate.
2. **Tenant stamp on creation.** `automation_definitions.tenantId` is set server-side from the caller's `TenantContext`; the NL descriptor schema carries no tenant field at all, so it cannot influence this. Locked in as a written invariant, same class as `QuerySpecExecutor.tenantFilter`. Regression test required: assert a created row's `tenantId` matches the caller even under an adversarial descriptor, mirroring Pillar 1's adapter-example tenant-echo test.
3. **Retry-sweep validation.** Before ship, a smoke test injects a synthetic `draft_failed` row and confirms the new `reclaimForRetry` method actually reclaims and completes it against a real Drizzle store — the first real exercise of retry for any agent, given the Donor Response Agent's own retry logic has never run in production (and, per planning-stage investigation, structurally could not have — its store had no reclaim path at all). Post-launch, log every time `reclaimForRetry` returns a row so a dead-code regression is visible, not silent.
4. **Notification idempotency.** `notify_case_owner` is idempotent, keyed on `(case_id, assignee_id, definition_id)` — checked against `agent_actions` before sending, skipped if a successful send already exists for that key. The reassignment race is closed by re-reading `assignedToId` immediately before send rather than trusting the value captured at claim time.
5. **UI navigation coverage + soft-delete cascade.** All three new surfaces (creation/preview flow, automation management list, per-automation autonomy toggle) get an explicit navigation-integration Definition-of-Done item, now also codified project-wide as `PROC-001` (see Risk Register Updates). Soft-deleting an `automation_definitions` row forces its corresponding `tenant_agent_settings` autonomy to `off` in the same transaction, so a deleted automation can never keep firing on a stale settings row.
6. **Sections 7-8 (error handling, testing strategy)** — had no recorded content prior to this spec; both are fully specified below under Error Handling and Testing Strategy.

## Alignment-Analysis Resolutions (F1-F5, verified against real code via investigation)

- **F1 — trigger-detection existence model.** Confirmed the Donor Response Agent's cron does a single-fixed-`agentId` INNER JOIN against `tenant_agent_settings`. This pillar has no single fixed `agentId` — every automation gets its own synthetic `automation:{definitionId}`, and multiple automations (same or different tenants) can share a `trigger_event`. Resolved: trigger detection is a two-level lookup — join `case_created` events against **all** active `automation_definitions` rows matching `trigger_event`, then check each match's own synthetic `tenant_agent_settings` row for autonomy `!= off`. One triggering event can fan out into zero, one, or several independent actions (see Trigger Detection below).
- **F2 — `ToolRegistry`/`SecurityAuditLog`.** Confirmed the structural gap remains and the recurrence risk is real (Pillar 3's approve/reject routes are hardcoded per-agent and can't be reused). Resolved: `securityAuditLog` becomes a required constructor parameter (no default) as part of this pillar's core changes — filed as `RISK-009`, blocking for this pillar's new route.
- **F3 — RISK-007 (idempotency).** The notify-tool's idempotency guard reduces but doesn't close the core-level gap in `confirmAndExecute`/`reject`. Deferred by explicit decision to keep this pillar's scope contained; `RISK-007` amended to record the new exposure surface and its raised priority.
- **F4 — recurring nav-integration defect.** Promoted from a per-pillar reminder to a standing, project-wide process rule: `PROC-001` in `RISK-REGISTER.md`.
- **F5 — cross-reference against `RISK-REGISTER.md`.** Applied: `RISK-007` amended, `RISK-009` filed, `PROC-001` added — all done 2026-09-06, ahead of this spec, so the spec reflects the register rather than the register trailing the spec.

## Core Additions to `@aria/core`

- **`AgentDefinition.buildDraft?(input: Input): AgentDraftOutput | Promise<AgentDraftOutput>`** — optional, added alongside the existing `buildPrompt`/`parseOutput`/`enrichSnapshot`/`action`/`buildToolArgs`/`checkAutonomy` fields. When present, `AgentRunner.run()` calls it directly instead of `buildPrompt`/LLM-call/`parseOutput`. Additive only; no existing `AgentDefinition` is affected. The automation's own `AgentDefinition<AutomationTriggerInput>` still supplies `enrichSnapshot`/`buildToolArgs`/`checkAutonomy`/`action` like any other agent — `buildDraft` only replaces the LLM-drafting step, not the rest of the framework's contract.
- **`AgentActionStore.reclaimForRetry(params: {tenantId: string; agentId: string; sourceType: string; sourceId: string; maxAttempts: number}): Promise<AgentAction | null>`** — new interface method. Atomically transitions an existing `draft_failed` row (for the given triple, `attemptCount < maxAttempts`) back to `processing` and returns it, or returns `null` if no such row exists or it's already at the retry cap. Implemented in both `InMemoryAgentActionStore` (porting its existing but currently-unreachable reclaim logic to this explicit method) and `createDrizzleAgentActionStore` (a real conditional `UPDATE ... WHERE status = 'draft_failed' AND attempt_count < $maxAttempts RETURNING *`, the first real implementation of this path against Postgres). Required because `claim()`'s `onConflictDoNothing` has no way to ever reclaim an existing row.
- **`ToolRegistry` constructor:** `securityAuditLog` becomes a required parameter (no default) — closes `RISK-009`, which planning-stage investigation confirmed is a tenant-enforcement bypass when omitted, not just an audit-trail gap (see Investigation Findings). All 3 existing instances already pass it correctly, so this is expected to be a non-breaking tightening; confirmed via a full-workspace check during planning (see Open Items).
- **A new, generalized approve/reject mechanism** capable of resolving a full `AgentDefinition` dynamically from a synthetic `agent_id` (parsing the `automation:` prefix, looking up the corresponding `automation_definitions` row, and constructing `buildToolArgs`/`enrichSnapshot`/`checkAutonomy`/`action` from it), rather than the hardcoded-per-agent pattern Pillar 3's routes use (`donorResponseAgentDefinition` imported directly) — required because this pillar's actions don't share one fixed `agentId`.

## Data Model

- **`automation_definitions`** (new table): `id, tenantId, name, triggerEvent, condition (jsonb, validated-pipeline-only), actionType, actionConfig (jsonb, validated-pipeline-only), isActive, createdAt, updatedAt`. `triggerEvent`/`actionType` immutable after creation; `id` is a permanent invariant (it's the basis of the synthetic `agent_id`).
- **`tenant_agent_settings`** (existing, unchanged schema): keyed by `(tenantId, agentId)`, where `agentId = automation:{definitionId}` for each automation — zero core schema change needed.
- **Permission model:** `admin`/`manager`/`super_admin` only for create/edit/delete/approve/reject, matching the existing `requireRole` pattern.
- **Cap:** 20 active automations per tenant, enforced at creation.
- **Deletion:** soft-delete only (`is_active = false`); in the same transaction, the corresponding `tenant_agent_settings` row's autonomy is forced to `off`.

## NL → Descriptor → Preview Flow

- V1 whitelist: exactly one entry (event `case_created`, action `notify_case_owner`).
- The LLM proposes a descriptor from free text; the server validates it against the typed whitelist, mirroring `QuerySpecExecutor`.
- The create UI shows "Automations available today" alongside the free-text input, so the feature isn't framed as unbounded.
- On validation failure: a fixed, sanitized response ("I can't build that yet — here's what I can build today: [...]") — never raw validator error text.
- Nothing persists until the user confirms a plain-English preview of the validated descriptor.
- New automations default to `confirm` autonomy, never `auto`.

## Trigger Detection (polling, event-source seam)

- Behind a small "event source" seam so a future real event bus is a swap at that seam, not a rewrite — deliberately not building a general event bus now.
- Query: `case_created` events joined against **all** active `automation_definitions` rows matching `trigger_event = 'case_created'` (not a single fixed-`agentId` join — see F1). For each match, check that match's own synthetic `tenant_agent_settings` row (`agentId = automation:{definitionId}`) for autonomy `!= off` before claiming. One triggering event can fan out into multiple independent actions if a tenant has more than one matching automation.
- The candidate-selection query runs two separate lookups per poll: new sources (no matching `agent_actions` row at all) call `claim()` as today; sources with an existing `draft_failed` row (`attemptCount < 3`) call the new `reclaimForRetry()` instead (gap-analysis finding #1, corrected during planning — see Investigation Findings). This is a genuinely new, first-ever-exercised-in-production code path, covered by the pre-ship smoke test in Testing Strategy.

## Notify Action Tool

- `notify_case_owner`: notifies `cases.assignedToId` via the existing in-app notification system (`resourceType: "case"`); falls back to `notifyStaff()` broadly if unassigned.
- Idempotent: keyed on `(case_id, assignee_id, definition_id)`, checked against `agent_actions` before sending; skipped if a successful send already exists for that key.
- Reassignment race closed by re-reading `assignedToId` immediately before send, not trusting the value captured at claim time.
- Registered on an existing, already-audited `ToolRegistry` instance where possible; the new generalized approve/reject route (Core Additions) requires `securityAuditLog` at construction time, closing `RISK-009` for this and all future consumers.

## Autonomy / Approval UI

- Off/confirm/auto per automation via the synthetic `agent_id` pattern, same UI shape as Pillar 3's per-agent toggle.
- Three new surfaces this pillar introduces — creation/preview flow, automation management list, per-automation autonomy toggle — are all covered by `PROC-001`: each must be linked into real navigation before this pillar is done, verified at final review, not left to be remembered.
- Failed drafts must be staff-visible and retriable, not silently invisible — explicitly not repeating Pillar 3's shipped defect.

## Error Handling

- All user-facing failures (whitelist rejection, LLM error, DB error) route through one sanitized-response path, reusing `QuerySpecExecutor`'s existing mechanism rather than a second implementation.
- Trigger-detection poll failures (DB unreachable, etc.) are logged and retried on the next poll cycle, never silently escalated.
- Action-execution failures mark the row `draft_failed`, picked up by the retry-sweep; after a max-attempt cap (3, matching Pillar 3's precedent), escalate to `needs_attention` with a staff-visible indicator.

## Testing Strategy

- **Unit:** whitelist accept/reject including the sanitized-rejection path; the tenant-stamp invariant (an adversarial descriptor cannot override the caller's `tenantId`); the notify-tool idempotency key; the two-level trigger-detection join (F1); `reclaimForRetry` actually transitioning a `draft_failed` row back to `processing` in `InMemoryAgentActionStore`, AND the same behavior against a real Drizzle table (not mocked) in `createDrizzleAgentActionStore` — this is the exact class of gap (a store-level behavior never exercised against real Postgres) that shipped invisibly before.
- **Integration:** end-to-end NL → descriptor → confirm → persist → trigger → notify flow against `adapter-example` (or a CorpFlow-like fixture), mirroring Pillar 1's adapter-example tenant-echo test and Pillar 3's donor-response end-to-end test.
- **Live-model smoke test required before this pillar is considered done** — this project's now three-times-learned lesson (Phase 1's memory markdown-fence bug, the `MemoryManager` trailing-prose bug, the under-specified tenant-scoping smoke-test prompt). Covers adversarial and legitimate NL phrasing, checking both the sanitized-rejection behavior and the successful-path behavior against a live model.
- **Real-DB test for the retry-reclaim path specifically** — it has never been validated against live infrastructure by any consumer before this pillar.

## Documentation & Risk Register Updates (already applied, 2026-09-06)

- **`RISK-007` amended:** this pillar's `notify_case_owner` idempotency guard reduces but doesn't close the underlying `confirmAndExecute`/`reject` gap; deferred by explicit decision, raising this risk's priority since it now has a second real consumer.
- **`RISK-009` filed:** `ToolRegistry`'s `securityAuditLog` wiring was optional, not structurally enforced — blocking for this pillar's new route; resolved by making it a required constructor parameter as part of this pillar's core changes.
- **`PROC-001` added (Standing Process Rules):** every new UI surface must be linked into real navigation before a pillar is done — promoted project-wide after recurring across Pillars 3 and 4.

## Open Items Carried Into the Implementation Plan

- Exact `automation_definitions` column types/indexes, and the index needed to make the two-level trigger-detection join (F1) efficient at scale — not yet designed at the SQL level.
- Whether the new generalized approve/reject route replaces or sits alongside Pillar 3's existing donor-response-specific routes — a real architectural choice for planning, not decided here.
- Exact copy for the "Automations available today" list and the sanitized rejection message.
- Whether `notifyStaff()`'s "broadly" fallback needs its own dedup/digest mechanism for high-volume tenants — flagged during red-team, not designed; the notify action's idempotency key doesn't itself throttle repeated *distinct* notifications.
- Confirm making `ToolRegistry.securityAuditLog` required breaks no consumer beyond the 3 already-correct instances — expected to be a non-issue, but worth a full-workspace check during planning rather than assuming.
