# CorpFlow Tenant-Scoping Layer — Design Spec

**Date:** 2026-08-29
**Status:** Draft, pending user review of this file
**Source material:** the `corpflow-second-adapter-pivot` decision (2026-08-28); a fresh read-only investigation of CorpFlow's real code at `/Users/mrdrdaddy/Desktop/AI Learning Journey /Coding Projects/MAC Portal Blueprint/corpflow` (not the pasted competitive brief alone); `packages/core/` as it exists after the `@aria/adapter-fitness` phase

## What This Is

`@aria/core` becoming CorpFlow's real second adapter (`@aria/adapter-corpflow`, decided 2026-08-28, see `project_corpflow_second_adapter_pivot`) was flagged as too large for a single spec — four independent pillars (cross-module Q&A, plain-English automation building, autonomous agents, tenant-scoping) plus a progressive-disclosure requirement. This spec covers **only the first sub-project: the tenant-scoping layer.** It was chosen to go first because none of the other three pillars can be built safely without it — CorpFlow has no existing structural pattern any of them could lean on (see Investigation Findings below) — and because it's the direct, structural fix for a documented, still-open production gap.

**Out of scope for this spec, each tracked separately:**
- Fixing CorpFlow's Postgres connection/RLS posture so Row-Level Security actually enforces anything (see Finding 2 below) — filed as a recommended follow-up, not built here, to avoid this sub-project ballooning into a whole-app DB migration.
- Progressive disclosure (ARIA respecting `app_modules.isEnabled`) — the clear second sub-project, not started here.
- Cross-module Q&A content, the automation builder, and autonomous agents — none of these are designed here; this spec only makes the underlying data-access mechanism they'll all eventually use safe.

## Investigation Findings (grounding this design in real code, not the pasted brief)

A fresh investigation of CorpFlow's actual source (not just the marketing brief that motivated the pivot) surfaced findings material enough to change the design before it was written down:

1. **Current ARIA has no tool-calling framework at all.** `src/lib/aria/` (938 lines), `src/components/aria/` (1,352 lines), `src/app/api/aria/` (763 lines), plus a parallel `src/app/api/ai/*` family (1,682 lines across 16 single-purpose generation routes) total ~4,735 lines. `src/lib/ai/client.ts`'s `aiComplete`/`aiJSON` is a plain prompt-completion wrapper — chat plus discrete one-shot generators, nothing agentic to extend.
2. **The tenant-scoping bug is not an isolated defect — it's the sharpest instance of the app's general pattern.** `src/app/api/ai/nl-query/route.ts` has the LLM generate a SQL WHERE-fragment; the only enforcement is `hasTenantPlaceholder()`, a substring check (`query.includes("$1")`) that a stray token anywhere in the query satisfies. This is already documented, unfixed debt (`PROJECT_MEMORY.md` line 36). More importantly: CorpFlow's `CLAUDE.md` claims "RLS enforces tenant isolation on every table — no exceptions," but `src/lib/db/index.ts` connects as the Postgres **superuser** role (per `.env.example`), which bypasses RLS by default, and `auth.jwt()` (which the RLS policies key off) is a Supabase Auth/PostgREST construct never populated on a raw superuser connection. **Real tenant isolation for every ordinary CRUD feature is hand-written `eq(table.tenantId, user.tenantId)` filters, copy-pasted per query, enforced only by convention and a test suite — not by architecture.** A tenant-scoping layer for ARIA cannot assume it can hook into an existing enforced mechanism; there isn't one, AI or not.
3. **The "Grant-Writing Agent" is not an agent.** `grant-writer.tsx` + `api/ai/grant-writing/route.ts` is a form that makes one LLM call and renders copy-pasteable text — no DB write, no persistence, nothing autonomous. Useful as UX precedent only, not architectural precedent.
4. **Module enablement is real and DB-backed, but ARIA is entirely unaware of it.** `app_modules` (`tenantId`, `slug`, `isEnabled`) is a working, tenant-scoped table with its own API route. Grepping all of `src/lib/aria`, `src/app/api/aria`, `src/app/api/ai` for any reference to it returns zero hits — `system-prompt.ts` unconditionally advertises the full nonprofit feature surface regardless of what a tenant has enabled. (This is the next sub-project, not solved here — noted for continuity.)

## Design Decision: Structural Elimination, Not Validation, at Every Layer

The same principle applies twice in this design, at two different layers, because a first-draft version of it only applied the principle once and a red-team pass found the gap:

- **Layer 1 (already decided 2026-08-29, in chat):** ARIA never lets the LLM generate a raw query. Read actions go through a constrained descriptor; write/action tools go through `@aria/core`'s existing `ToolRegistry` (from Phase 1). Tenant identity is always server-injected from session context, never accepted from LLM output, even if supplied.
- **Layer 2 (added after red-team):** the descriptor path's *safety* cannot itself depend on trusting adapter-supplied code to "do the right thing" with the rest of the query (filter values, sort keys, aggregations) — that reintroduces exactly the class of bug this project exists to close, one level down. So the adapter supplies only inert data (typed column references, an allow-list of aggregations), never a function that builds a query. Core owns query construction end-to-end, using only parameterized operators. See `QuerySpecExecutor` below.

## Core Additions to `@aria/core`

### `tenant-context.ts` — `TenantContext`

`{ tenantId: string }`. Constructed once per inbound request from server-side session data (CorpFlow's existing auth, unchanged) and **re-derived fresh for every tool or query invocation within a conversation** — never cached or reused across turns. This closes a possible stale-context window if a session could ever span a tenant/entity switch mid-conversation (see Open Items — this is a defensive default pending verification, not a confirmed CorpFlow behavior).

Any `tenantId`-shaped field arriving through an LLM tool-call argument or query descriptor is stripped before use and its presence is logged as a violation (see `SecurityAuditLog`), not silently ignored — the LLM attempting to supply tenant identity at all is itself a signal worth recording, not just a no-op.

### `ToolRegistry` — tenant-scoped mode

**Corrected during planning to match `ToolRegistry`'s real existing signature** (`execute(userId, toolName, args)`, no context parameter today). `execute()` gains an optional 4th parameter, `tenant?: TenantContext`; `Tool.handler` gains an optional 3rd parameter of the same type — both additions are backward-compatible (existing two/three-argument callers and handlers in `adapter-fitness`/`adapter-example` remain valid). `ChatEngine.sendMessage()` gains a matching optional 4th parameter, threaded down to `toolRegistry.execute()`, so a caller resolves `TenantContext` fresh per call and passes it in — never cached on the engine instance. When a `SecurityAuditLog` is configured on the registry (tenant-scoped mode is opt-in via this, not a separate boolean), `execute()` also strips and logs any LLM-supplied `tenantId`-shaped argument before validation, and logs+fails if tenant-scoped mode is on but no `TenantContext` was passed. This path already had the strongest possible guarantee among the three (typed function arguments, no composed SQL) and needed no further hardening after the red-team pass — only this signature correction.

### `query-spec-executor.ts` — `QuerySpecExecutor`

Replaces an earlier draft's "adapter-supplied compiler function" design, removed specifically because it reopened an injection class (see Verification Note below).

**Designed to be usable standalone, not only from inside `ChatEngine`'s tool loop.** A planning-stage investigation found CorpFlow's ARIA doesn't call `@aria/core`'s `ChatEngine` at all today — `aria/message/route.ts` uses CorpFlow's own bespoke chat implementation directly. Migrating CorpFlow's full chat flow onto `ChatEngine` is separate, larger future work, not something this sub-project takes on silently. `nl-query` (this sub-project's real migration target, see Migration Scope below) is a one-shot analytics endpoint, not a conversational turn — it has no use for crisis filtering, topic guardrails, sentiment, or memory. So `QuerySpecExecutor` takes `(descriptor, context: TenantContext, whitelist: QueryWhitelist)` directly and can be called from any request handler; `ChatEngine`'s tool loop is one caller among possibly several, not a required wrapper.

**Corrected during planning: core stays ORM-agnostic, matching every other core interface (`LLMProvider`, `AriaHistoryStore`, `AriaMemoryStore`) — it never depends on Drizzle or any specific ORM.**

- The adapter supplies a `QueryWhitelist`: opaque, adapter-defined column references (real Drizzle column objects for CorpFlow, but core never inspects their internals) keyed by `{table, column}` string, plus which aggregation functions (`count`/`sum`/`avg`) are allowed per table, which columns are sortable, and which whitelist key is that table's tenant-id column.
- The LLM's query descriptor (`{ table, columns, filters, aggregation, sort, limit }`) may only reference tables/columns/aggregations by whitelist key — an LLM-supplied string is resolved through the whitelist lookup and never reaches any query-building code as a raw string.
- Core validates the descriptor and produces a `ResolvedQueryPlan`: whitelist-resolved column references, typed filter values, and — as a **mandatory, separate, always-present field** (not merely first in an array a careless implementation could skip) — the tenant filter (whitelisted tenant-column ref + `context.tenantId`). This shape makes "forgot to apply the tenant filter" a type error for the adapter to write, not a possible oversight.
- The adapter implements a thin `QueryPlanRunner(plan: ResolvedQueryPlan): Promise<Record<string, unknown>[]>` — the *only* piece of adapter code in this whole path, and it never sees an LLM-influenced string, only already-resolved refs and typed values. For CorpFlow, this is a few lines of Drizzle (`eq`/`and`/`gte`/etc.) applied to `plan`'s fields — small and easy to unit-test in isolation for "does it always apply `plan.tenantFilter`."
- Any error thrown by `QueryPlanRunner` is caught and replaced with a generic failure before it reaches the LLM or the user — raw DB error text (which could reveal schema or cross-tenant data via an error-based leak) is never surfaced.

### `security-audit-log.ts` — `SecurityAuditLog`

Interface; adapter implements storage. Logs three violation categories: (1) a non-whitelisted table/column/aggregation request, (2) an LLM-supplied tenant identifier of any kind, (3) a tool or query call missing required tenant context entirely.

**Corrected: not "any violation aborts the operation."** The actually implemented, deliberately-designed behavior differs by category, and is consistently applied the same way in both `ToolRegistry.execute()` and `QuerySpecExecutor.execute()`:

- Categories (1) and (3) do reject the call — a non-whitelisted table/column/aggregation/sort, or a missing required `TenantContext`, causes that specific call/query to fail safely (a generic error result, never a thrown exception), after logging the violation.
- Category (2) — an LLM-supplied tenant identifier (a `tenantId`/`tenant_id` field in tool-call arguments, or a descriptor filter targeting the tenant column) — does **not** abort anything. The offending field/filter is stripped, the violation is logged, and the call proceeds and succeeds using the real, trusted tenant context from `TenantContext` in place of whatever the LLM tried to supply.

No violation category halts anything beyond the single call/query it occurred on — there is no cross-request or session-level abort behavior.

**`onCriticalViolation` is a required constructor parameter, not optional.** This is a direct lesson from the adapter-fitness phase, where `MemoryManager.onError` being optional meant both reference adapters shipped without wiring it, making a broken subsystem silent. A security-relevant callback gets the stricter treatment: `SecurityAuditLog` cannot be constructed without it.

## Data Flow

**`QuerySpecExecutor`, standalone (this sub-project's real path — `nl-query`'s replacement route):**

1. Route calls `verifyAuth()` (unchanged, existing CorpFlow auth) to get `user.tenantId`.
2. `TenantContext` constructed from `user.tenantId` — fresh per request, never cached.
3. LLM call (via the adapter's provider, `aiJSON`-equivalent) produces a query descriptor referencing only `QueryWhitelist` keys.
4. `QuerySpecExecutor` validates every key against `QueryWhitelist`, builds the full parameterized query including the forced tenant predicate, executes, and returns either results or a generic failure — raw DB errors never surface.
5. Any violation (non-whitelisted key, LLM-supplied tenant field) short-circuits to a logged rejection (via `SecurityAuditLog`, triggering `onCriticalViolation`) and a safe "I couldn't safely answer that" response — never a partial or unscoped result.

**`ToolRegistry` tenant-scoped mode, for future use inside `ChatEngine.sendMessage()`** (not exercised by CorpFlow's own deliverable in this sub-project, since its chat route doesn't call `ChatEngine` yet — proven instead via a synthetic `@aria/adapter-example` tool, the same way Phase 1 proved new core mechanisms before a real adapter existed; documented here because the mechanism ships in `@aria/core` now and future pillars depend on it): caller resolves `TenantContext` fresh and passes it as `sendMessage()`'s 4th argument → threaded to `toolRegistry.execute(userId, name, args, tenant)` → each tool handler receives it as its 3rd argument → any violation short-circuits the same way as above.

## `@aria/adapter-corpflow` Package Contents (this sub-project's slice only)

```
packages/adapter-corpflow/          # lives in this monorepo, git-tag-pinned dependency for CorpFlow (decided 2026-08-29)
├── src/
│   ├── nl-query-whitelist.ts       # QueryWhitelist for the 8 tables nl-query's real prompt already names
│   ├── nl-query-runner.ts          # QueryPlanRunner implementation using Drizzle's eq/and/gte/etc.
│   ├── security-audit-log.ts       # SecurityAuditLog implementation + notifyTenantScopingViolation wiring
│   └── index.ts                    # wires TenantContext + QuerySpecExecutor for CorpFlow's nl-query route to call
└── test/
    ├── nl-query-runner.test.ts     # asserts plan.tenantFilter is always applied, never overridable
    └── security-audit-log.test.ts
```

This package intentionally does not include a `tools.ts` or a `ChatEngine` instance — see Migration Scope below for why only `nl-query` is touched in this sub-project.

## Migration Scope (closes a gap-analysis/red-team finding)

**Revised after a real-code investigation done during planning.** An earlier draft required classifying all 21 existing `api/aria/*`/`api/ai/*` routes as migrate-now/decommission/confirmed-no-tenant-data, written before any of them had actually been read. That read found the vulnerability class this sub-project exists to close — **the LLM itself determining query scoping** — exists in exactly **one** of the 21 routes: `nl-query`. Every other route, including `data-hygiene` (which also runs raw SQL), uses hand-written Drizzle queries with server-set `eq(tenantId, ...)` filters; the LLM never influences what gets queried or how it's scoped in any of them. Requiring code changes to 20 routes that were never vulnerable to this bug class would be scope creep into the future cross-module-Q&A/automation-builder pillars' job (turning one-shot generators into reusable tools), not this sub-project's mandate — so the classification is narrowed to match the real risk:

- **`nl-query`: migrate now, non-negotiably.** Rebuilt on `QuerySpecExecutor` as part of this sub-project — it is the concrete instance of the bug this sub-project exists to fix, and becomes this sub-project's real end-to-end proof against a live model (closing the separate gap-analysis finding that this layer could otherwise ship with no real caller to validate it).
- **The other 20 routes: documented, not modified.** Each gets a one-line note in the implementation plan recording that its tenant scoping is server-controlled (not LLM-influenced) and therefore correctly out of scope for this sub-project — a factual record, not a silent omission.

## Testing Strategy

- Unit tests for `QuerySpecExecutor` against `QueryWhitelist`, including an adversarial suite: a descriptor referencing a non-whitelisted table/column; a filter or sort value crafted as a SQL-injection attempt (must be treated as an inert bound value, never code); a descriptor that includes its own (wrong) tenant filter (must be overridden, never honored).
- A test confirming `TenantContext` is re-derived, not reused, across multiple tool/query calls within one conversation.
- A test confirming `SecurityAuditLog` cannot be constructed without `onCriticalViolation`.
- A test confirming the migrated `nl-query` replacement rejects the exact bypass string that defeated the original `hasTenantPlaceholder()` check.
- A live-model smoke test analogous to adapter-fitness's memory smoke test: send real cross-tenant-adjacent queries against a live Anthropic key using two distinct test tenants, and assert zero cross-tenant data ever appears in either tenant's results. This is the security-critical equivalent of the lesson already learned twice on this project (stub-based tests missed both the chat-engine prefill bug and the memory markdown-fence bug) — a live adversarial check is required before this sub-project is called done, not optional.

## Documentation & Risk Register Updates

`RISK-REGISTER.md` gets a new **RISK-004**, filed alongside this spec, covering residual risks deliberately accepted rather than solved here:
1. **Indirect prompt injection via legitimately-returned tenant data.** Data a scoped tool or query correctly returns (e.g., a CRM note field) could itself contain text crafted to manipulate the LLM's *next* action. This design mitigates only the error-message-leak instantiation of this risk (raw DB errors never surface); the general case — adversarial content steering a subsequent tool call — is not solved here.
2. **Query whitelist doesn't yet gate on per-tenant module enablement.** A tenant without, e.g., the Grants module enabled could still successfully query a globally-whitelisted grants-related table. Not a tenant-boundary leak, but a feature-gating gap using the same mechanism — the progressive-disclosure sub-project is expected to close this.
3. ~~Multi-entity/multi-tenant session ambiguity is unverified.~~ **Resolved during planning (2026-08-29):** CorpFlow already resolves a single `tenantId` per request via `verifyAuth()` → `resolveActiveDbUser()`, using an `active-tenant` cookie checked against a real `user_entity_memberships` table for users who belong to multiple tenants. `TenantContext`'s single-`tenantId` design is correct as specified — it should consume `verifyAuth()`'s already-resolved `tenantId`, never attempt to re-derive tenant identity from the auth id itself. **Separately noted, not this project's bug to fix:** `resolveActiveDbUser()`'s fallback when the cookie is missing/invalid picks "the first `users` row matching this auth id" with no deterministic ordering, not even using the `isPrimary` flag that exists on `user_entity_memberships` for exactly this case — a real, pre-existing non-determinism in CorpFlow's own auth code, inherited as-is by this tenant-scoping layer (whatever `verifyAuth()` returns is trusted, correctly, by our contract) but independent of and out of scope for this sub-project. Flagged to the user directly outside this spec as something CorpFlow's own team may want to fix.
4. **`SecurityAuditLog` is intended as the same system the future autonomous-agents pillar's audit-trail requirement will extend**, not a separate one — stated here explicitly so the agents sub-project doesn't independently reinvent audit logging.
5. **`onCriticalViolation` wiring: resolved during planning.** CorpFlow has a real Slack bot integration (`src/lib/slack/notifications.ts`, e.g. `notifySLABreach`) on a global admin-alerts channel — no generic `logSecurityEvent`-style helper exists yet. Adapter-corpflow's `onCriticalViolation` implementation adds a `notifyTenantScopingViolation()` function to that same file, following its existing pattern exactly.

Recommended, not built here (would expand this sub-project into a whole-app migration): fixing CorpFlow's DB connection to use a non-superuser, per-request-scoped role with `FORCE ROW LEVEL SECURITY`, so Postgres itself would catch a code-level scoping bug as true defense-in-depth. Filed as a strongly-recommended follow-up for CorpFlow's own backlog.

## Verification Note: why this design differs from the first version presented in chat

The first version of this design gave `QuerySpecExecutor` an adapter-supplied "compiler function" that would turn an LLM-produced descriptor into a real query, with core forcibly ANDing a tenant predicate on top of whatever the adapter returned. A red-team pass found this reopened the same bug class the sub-project exists to close, one layer down: core's guarantee on the tenant predicate is real, but irrelevant if the adapter's compiler builds any other part of the query — a filter value, a sort key — via string interpolation, which is a common real-world gap in hand-rolled ORM code built under time pressure. The fix was architectural, not a stricter instruction to the adapter: remove the adapter's ability to see or act on any LLM-influenced *string*. Core validates the descriptor and resolves it to a `ResolvedQueryPlan` of already-safe, already-typed values with the tenant filter as a mandatory top-level field; the adapter's only remaining code is a thin `QueryPlanRunner` that turns that already-safe plan into a real query using whatever ORM it likes — a much smaller, much more auditable surface than "compile an arbitrary descriptor." (A second correction, made during planning rather than the earlier red-team pass: the first post-red-team draft still had core calling Drizzle operators directly, which would have made `@aria/core` depend on a specific ORM — inconsistent with every other core interface, all of which are adapter-implemented. `QueryPlanRunner` fixes this the same way `AriaMemoryStore`/`AriaHistoryStore` already do for their own concerns.) A gap-analysis pass separately found the original design had no real end-to-end consumer (all four CorpFlow pillars deferred content decisions past this sub-project), which risked shipping an unvalidated mechanism the same way this project's memory-summarization subsystem shipped unvalidated against a live model for a full phase — resolved by making the `nl-query` migration this sub-project's required proof, not a later nice-to-have.

## Open Items Carried Into the Implementation Plan

- **Package location: decided 2026-08-29.** `@aria/adapter-corpflow` lives in this monorepo (`packages/adapter-corpflow`), consumed by CorpFlow as a git-tag-pinned dependency — matching Phase 1's versioning story. Chosen specifically to keep the core/adapter boundary structurally enforced by a real repo separation, in service of `@aria/core` staying generic and reusable across apps rather than accumulating CorpFlow-specific assumptions.
- **Route migration scope: resolved during planning.** Only `nl-query` is migrated; the other 20 routes get a documented, no-code-change classification. See Migration Scope above.
- **Multi-entity session verification: resolved during planning.** See RISK-004 item 3 above.
- **`SecurityAuditLog` alerting: resolved during planning.** See RISK-004 item 5 above.
