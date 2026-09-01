# CorpFlow Autonomous Agents — Design Spec (Framework + Donor Response Agent)

## What This Is

The third of CorpFlow's four planned ARIA pillars ([[project_corpflow_second_adapter_pivot]]), and the first to require new mechanism in `@aria/core`. The original brief asked for "domain-specific autonomous agents" with four illustrative examples (Lead-Response, Grant-Writing extension, Donor-Engagement, Standup/Status). This spec does not build all four — it builds the reusable agent framework in `@aria/core`, plus exactly one real, working agent (**Donor Response Agent**) as the required end-to-end proof, following the same pattern the tenant-scoping pillar used: mechanism belongs in core, one real consumer proves it, the rest is adapter content to build later.

**Why Donor Response, not Lead-Response as originally proposed:** investigation found CorpFlow has no "leads" concept at all — no `leads` table, and `sales_pipeline` (the closest analogue, where `"lead"` is only a default pipeline *stage* string) has no creation endpoint anywhere in the codebase. The closest real, working, genuinely public-facing flow where an external party's action plausibly deserves a personalized automated response is donation-form submission (`donation_form_submissions`, `src/app/api/donation-forms/[id]/submit/route.ts`).

## Investigation Findings (grounding this design in real code, not the pasted brief)

- CorpFlow's own AI code has **zero active tool-calling** in use anywhere in `src/`. A real tool-calling framework (`ToolRegistry`/`ChatEngine`) already exists as a dependency (`@aria/core`, added for tenant-scoping) but is imported nowhere in CorpFlow's code today.
- The only existing background/scheduled mechanism in CorpFlow is a single Vercel Cron entry (`vercel.json`) hitting `/api/cron/[job]/route.ts`, a small registry-pattern handler gated by a `CRON_SECRET` header. Two jobs are currently registered (`heartbeat`, `good-standing-check`), both DB-only, neither calling the LLM. No queue/job system (Bull, Inngest, etc.) exists.
- The Grant-Writing "Agent" mentioned in product docs is still a one-shot form → single LLM call → render, no persistence, no proactivity — unchanged since the original CorpFlow-pivot investigation in August.
- **The donation-form submit route sends no email at all today.** No instant receipt/thank-you exists for this specific flow — the route only returns a JSON message string the frontend displays. A real, reusable `sendEmail` helper (`src/lib/email/resend.ts`, Resend-based) exists and is used by an unrelated Stripe webhook route for a different donation path, but is never called from this route. The agent's drafted follow-up will be the first and only email this flow ever sends, not a second email on top of an existing one.
- `donation_form_submissions.donorEmail` is `NOT NULL` at both the DB and Zod-validation layer — a submission without a valid email cannot exist in this table.
- `donation_form_submissions.status` (`completed`/`pending`/`failed`/`refunded` per its column comment) is hardcoded to `"completed"` on every insert in this route — there is no real payment-processing call here today (no `paymentIntentId` ever set despite the column existing). This is a pre-existing CorpFlow gap, unrelated to this design, not addressed here — the agent defensively checks `status === 'completed'` anyway, to guard against CorpFlow later wiring up real payment states on this route without this design needing to change.
- A dead, unused `receiptSent` boolean column already sits on `donation_form_submissions` (default `false`, referenced nowhere) — not reused by this design; a new purpose-built claim mechanism is used instead (see Data Flow).

## Design Decision: A New, Standalone `AgentRunner` — Not Built on `ChatEngine`

Three approaches were considered. `ChatEngine` (reuse its full apparatus — history, memory, guardrails, sentiment) was rejected: it's shaped for multi-turn conversational chat, and a one-shot "draft a follow-up, gate it, get it confirmed" task doesn't have a conversation history and doesn't need memory summarization, guardrails, or sentiment detection — forcing it through `ChatEngine` means stubbing out machinery that doesn't apply. Skipping `@aria/core` entirely and building everything inside CorpFlow was also rejected: it abandons the mechanism-in-core/content-in-adapter pattern already validated three times (tools/guardrails/sentiment/memory, then tenant-scoping), meaning a future fitness-side proactive agent would have to reinvent gating and audit logic from scratch.

The chosen design: a new, purpose-built `AgentRunner` in `@aria/core`, independent of `ChatEngine`, that reuses only what genuinely applies — `LLMProvider` (the same interface `ChatEngine` uses) and `ToolRegistry` (specifically for tenant-scoped execution of the agent's gated action).

## Core Additions to `@aria/core`

### `agent-definition.ts` — `AgentDefinition<Input, Output>`

Adapter-supplied config for one agent:
- `id: string` (e.g. `'donor-response'`)
- `buildPrompt(input: Input): { systemPrompt: string; userPrompt: string }`
- `parseOutput(raw: string): Output` — uses a shared, extracted version of `stripMarkdownFence` (the same fence-tolerant parser fixed in `MemoryManager` earlier this project, now generalized into a shared core utility rather than living only in `memory-manager.ts`)
- `action: ToolDefinition` — the gated action this agent's output feeds (e.g. "send"), executed via `ToolRegistry`
- `checkAutonomy(tenantId: string): Promise<'off' | 'confirm' | 'auto'>`

### `agent-action-store.ts` — `AgentActionStore` (interface, adapter-supplied)

Same extensibility pattern as `AriaHistoryStore`/`AriaMemoryStore`. Persists one row per `(sourceType, sourceId, agentId)` — this triple is unique-constrained at the storage layer, which is what makes claiming atomic (see Data Flow). Fields include: `id, tenantId, agentId, sourceType, sourceId, status, draftContent, sourceSnapshot (structured facts used to build the prompt, for staff cross-checking against the drafted prose), attemptCount, confirmedByUserId, createdAt, updatedAt`.

Status values: `processing → (pending_confirm | auto_sent | draft_failed) → (sent | edited_and_sent | rejected | send_failed | needs_attention)`.

### `agent-runner.ts` — `AgentRunner`

Constructor: `LLMProvider`, `ToolRegistry`, `AgentActionStore`.

- **`run(definition, input, tenantId)`** — checks autonomy first (`'off'` short-circuits with no LLM call, no cost); attempts the claim-insert; on success, calls `buildPrompt`, the LLM, `parseOutput`; on `'confirm'`, writes `pending_confirm` and stops; on `'auto'`, executes the action via `ToolRegistry.execute()` (tenant-scoped) and writes `auto_sent`. Any failure in the draft step is caught, never thrown — increments `attemptCount`, sets `draft_failed` (or `needs_attention` at the retry cap), fires an `onError` callback (matching `MemoryManager`'s existing pattern).
- **`confirmAndExecute(actionId, tenantId, opts?: { editedContent?: string })`** — staff-approved path; executes the action via `ToolRegistry`, updates status to `sent`/`edited_and_sent`, or `send_failed` on failure (a non-terminal state — the action resurfaces in the staff queue with retry available via the same method, rather than requiring a full re-draft).
- **`reject(actionId, tenantId)`** — marks `rejected`, no execution.

Retry cap: `attemptCount` maxes at 3 before `needs_attention` (terminal, alerted, excluded from future cron sweeps).

## Data Flow

```
Donor submits donation form
  -> donation_form_submissions row created (existing, unchanged)
  -> (no email sent today — confirmed by investigation, not assumed)

Every cron interval (new job registered in the existing /api/cron/[job] registry):
  -> for each tenant with autonomyLevel != 'off' for 'donor-response':
       -> query donation_form_submissions with no matching agent_actions row
       -> for each: INSERT INTO agent_actions (..., status='processing')
            ON CONFLICT (source_type, source_id, agent_id) DO NOTHING
            -- the insert succeeding IS the atomic claim; a concurrent
            -- second attempt gets zero rows back and skips it, no
            -- separate lock needed
       -> for each successfully claimed row: AgentRunner.run(donorResponseAgentDefinition, submission, tenantId)
            -> buildPrompt() includes an explicit computed `priorGiftCount`
               (never left for the LLM to infer) so a first-time donor
               never gets a fabricated "this is your Nth gift" reference
            -> LLM call -> shared fence-tolerant parse -> drafted follow-up
            -> autonomy 'confirm' (default) -> pending_confirm + Slack alert
               to staff (reusing CorpFlow's existing Slack integration,
               same one used for tenant-scoping violation alerts)
            -> autonomy 'auto' -> ToolRegistry.execute('send-donor-followup')
               immediately, ->  auto_sent

Staff-facing pending-actions queue (role-gated: admin/super_admin/manager,
matching the nl-query route's existing requireRole pattern):
  -> renders draftContent next to sourceSnapshot's real structured facts
     (amount, campaign, priorGiftCount) so staff can visually cross-check
     the drafted prose against ground truth before approving
  -> Approve (optionally edited) -> AgentRunner.confirmAndExecute()
  -> Reject -> AgentRunner.reject()

Cron-job-level failure (not a per-row draft/send error, the job itself
throwing) -> separate Slack alert, same integration.
```

## `@aria/adapter-corpflow` Package Contents (this sub-project's slice only)

- `DrizzleAgentActionStore` implementing `AgentActionStore` against a new `agent_actions` table, tested against real (not mocked) `drizzle-orm` operators — matching this project's established convention for this package (the `nl-query-whitelist` tests already do this).
- `donorResponseAgentDefinition`: the prompt builder (donation + `priorGiftCount` + org/campaign context), the `send-donor-followup` `ToolDefinition` (wired to CorpFlow's existing `sendEmail` helper), and the autonomy lookup against a new `tenant_agent_settings` table (default `'off'` when no row exists for a tenant/agent pair — tenants must consciously opt in, not silently inherit `'confirm'` behavior for a feature they never asked for).

## In CorpFlow Itself (not `@aria/core`/`@aria/adapter-corpflow` — the consuming app)

- New `donor-response-agent` job registered in the existing `/api/cron/[job]` registry.
- New `agent_actions` and `tenant_agent_settings` tables + migration.
- A staff-facing pending-actions queue page (Approve/Edit/Reject), role-gated per above.
- A per-tenant settings toggle for `off`/`confirm`/`auto`.

## Testing Strategy

- `AgentRunner` unit tests (mocked `LLMProvider`/`ToolRegistry`/`AgentActionStore`): confirm-gate path, auto-execute path, draft failure → retry → `needs_attention`, send failure → `send_failed` → retry via `confirmAndExecute`, reject path, edited-content confirm path.
- A concurrency test asserting two near-simultaneous `run()` calls for the same submission result in exactly one claimed row (the unique-constraint insert-as-claim mechanism) — this class of bug is easy to get subtly wrong and worth a real test, not just review.
- `DrizzleAgentActionStore` tested against real `drizzle-orm`, not mocks.
- CorpFlow-level: the cron job route, approve/reject endpoints (role-gating), the first-time-donor prompt branch.
- **A live-model smoke test is required before this is considered done** — the same lesson this project has now learned three times (Phase 2's memory markdown-fence bug, this session's `MemoryManager` trailing-prose bug, this session's under-specified smoke-test-prompt gap). Checks specifically: does the model correctly omit history references for `priorGiftCount === 0`, does it avoid fabricating any figure not present in `sourceSnapshot`, does the shared fence-tolerant parser survive real model output.

## Documentation & Risk Register Updates

**RISK-005 to be filed in `RISK-REGISTER.md`:** the Donor Response Agent's follow-up email is treated as transactional (tied to a specific just-made gift) with no separate consent/opt-out mechanism, on the reasoning that its consent basis matches a receipt rather than general marketing. Not verified against real legal/compliance review. Same treatment as RISK-001: not blocking initial build, must be revisited before this handles real donor communications at meaningful scale.

**Accepted, documented risk (not solved, by design):** a crash between an email send succeeding and the `agent_actions` status write recording `sent` could in theory cause a retry to double-send. True exactly-once semantics across an external email API and a DB write is out of scope for this feature's value — noted explicitly rather than silently ignored, consistent with how RISK-002/003 are already tracked in this project rather than engineered away.

## Open Items Carried Into the Implementation Plan

- Exact `agent_actions`/`tenant_agent_settings` column types and indexes (the "find unclaimed submissions" query needs an index that supports it efficiently at scale — not yet designed at the SQL level).
- Whether the shared fence-tolerant parser extraction (`stripMarkdownFence` moving from `memory-manager.ts` into a shared core utility) happens as its own task before or alongside `AgentDefinition`/`AgentRunner` — a small, mechanical refactor, not a design question, but needs a task boundary decided during planning.
- The exact Slack alert payload/wording for both the pending-draft notification and the cron-failure notification (content, not architecture).
- Whether `needs_attention` actions need their own dedicated view distinct from the `pending_confirm` queue, or share one UI with a status filter.
