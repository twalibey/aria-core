# @aria/adapter-corpflow

Tenant-scoping layer for CorpFlow's `nl-query` analytics endpoint, built on `@aria/core`'s `QuerySpecExecutor`. See `docs/superpowers/specs/2026-08-29-aria-corpflow-tenant-scoping-design.md` for the design and `docs/superpowers/plans/2026-08-29-aria-corpflow-tenant-scoping.md` for what shipped.

## What this package contains vs. what lives in CorpFlow's own repo

This package holds only the generic, schema-agnostic `createDrizzleQueryPlanRunner` factory. It has no dependency on CorpFlow's actual database schema. The CorpFlow-specific `QueryWhitelist` (real table/column references) necessarily lives inside CorpFlow's own repo (`src/lib/aria-tenant-scoping/nl-query-whitelist.ts`), since only that repo has the schema to reference.

## Scope

This package currently covers `nl-query` only — the one CorpFlow route (of 21 audited) where an LLM determines query scoping. The other 20 routes use server-controlled tenant filtering and were out of scope for this sub-project. See the design spec's "Migration Scope" section.

## Behavior change in v0.2.0

As of `v0.2.0`, `createDrizzleQueryPlanRunner` genuinely enforces the whitelist-validated column selection, aggregation, sort, and row-limit scoping on the query it renders. This was **not** true in `v0.1.0`, which silently discarded all of that and rendered every query as an effectively uncapped `SELECT *` — a real security-relevant regression that was found and fixed after the fact (see RISK-004 items 6 and the versioning note in `packages/core/README.md`). Anything still pinned to `adapter-corpflow-v0.1.0` does not have this enforcement.

## Limitations (carried from RISK-004)

- Indirect prompt injection via legitimately-returned data is only partially mitigated (see RISK-004 item 1).
- The query whitelist does not yet gate on per-tenant module enablement (RISK-004 item 2).
- A malformed query plan (no columns and no aggregation) falls back to a silent `_tenantId`-only result rather than an error (RISK-004 item 5).
- Test coverage for the query-plan runner is mock-based only, with no real-Drizzle SQL-rendering test (RISK-004 item 6).
- The `count` aggregation counts non-null values of a column, not rows — fine today, but worth checking if the whitelist is extended to a nullable column (RISK-004 item 7).
- The tenant-scoping-violation Slack alert has no severity tiering, creating alert-fatigue risk (RISK-004 item 8).

**Live smoke test:** run/not yet run — see scripts/live-tenant-scoping-smoke-test.ts. Do not consider this sub-project fully validated until this has been run against a real model at least once.
