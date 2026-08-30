import { and, eq, gt, gte, lt, lte, inArray, asc, desc, count, sum, avg, type SQL } from 'drizzle-orm';
import type { ResolvedQueryPlan, QueryPlanRunner } from '@aria/core';

// Minimal shape of what this runner needs from a Drizzle db instance —
// avoids depending on a specific Drizzle driver (postgres-js, node-postgres, etc.).
// Modeled on the real chain this runner actually calls:
// db.select(fields).from(table).where(condition)[.orderBy(...)].limit(n)
export interface DrizzleQueryable {
  select: (fields?: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (condition: SQL) => {
        orderBy: (...columns: unknown[]) => {
          limit: (n: number) => Promise<Record<string, unknown>[]>;
        };
        limit: (n: number) => Promise<Record<string, unknown>[]>;
      };
    };
  };
}

/**
 * Output key the aggregated value is returned under, e.g. `{ result: 42 }` for a `count`.
 * There is no natural "column name" for an aggregate, so this fixed key is a contract:
 * CorpFlow's route must read the aggregated value back out via `rows[0][AGGREGATION_RESULT_KEY]`.
 */
export const AGGREGATION_RESULT_KEY = 'result';

/**
 * Defensive fallback key used ONLY when a plan somehow has neither `columns` nor
 * `aggregation` set — see the comment in the runner body below for when this can happen
 * (in principle, never, if QuerySpecExecutor's own validation is correct).
 */
export const MALFORMED_PLAN_FALLBACK_KEY = '_tenantId';

function buildFilterCondition(filter: { ref: unknown; op: string; value: unknown }): SQL {
  const column = filter.ref as any;
  switch (filter.op) {
    case 'eq':
      return eq(column, filter.value);
    case 'gt':
      return gt(column, filter.value as number);
    case 'gte':
      return gte(column, filter.value as number);
    case 'lt':
      return lt(column, filter.value as number);
    case 'lte':
      return lte(column, filter.value as number);
    case 'in':
      return inArray(column, filter.value as (string | number)[]);
    default:
      throw new Error(`Unsupported filter operator: ${filter.op}`);
  }
}

function buildAggregationField(aggregation: NonNullable<ResolvedQueryPlan['aggregation']>): Record<string, SQL> {
  const ref = aggregation.ref as any;
  switch (aggregation.fn) {
    case 'count':
      return { [AGGREGATION_RESULT_KEY]: count(ref) };
    case 'sum':
      return { [AGGREGATION_RESULT_KEY]: sum(ref) };
    case 'avg':
      return { [AGGREGATION_RESULT_KEY]: avg(ref) };
    default:
      throw new Error(`Unsupported aggregation function: ${(aggregation as { fn: string }).fn}`);
  }
}

export function createDrizzleQueryPlanRunner(db: DrizzleQueryable): QueryPlanRunner {
  return async (plan: ResolvedQueryPlan) => {
    const tenantCondition = eq(plan.tenantFilter.ref as any, plan.tenantFilter.value);
    const otherConditions = plan.filters.map(buildFilterCondition);
    const condition = otherConditions.length > 0 ? and(tenantCondition, ...otherConditions)! : tenantCondition;

    let fields: Record<string, unknown>;
    if (plan.aggregation) {
      // Aggregation takes precedence over column projection — a query that asks
      // "how many X" must return a count row, not the matching rows themselves.
      fields = buildAggregationField(plan.aggregation);
    } else if (plan.columns.length > 0) {
      fields = Object.fromEntries(plan.columns.map(({ key, ref }) => [key, ref]));
    } else {
      // Malformed plan: no columns requested AND no aggregation. QuerySpecExecutor's own
      // validation should make this unreachable (a well-formed descriptor always carries
      // at least one column or an aggregation), but this runner does not trust that as a
      // guarantee — falling back to `db.select()` with no arguments would silently return
      // every column on the row (the exact bug this fix exists to close). Instead, project
      // only the tenant column, which is always whitelisted, resolved, and safe to return.
      fields = { [MALFORMED_PLAN_FALLBACK_KEY]: plan.tenantFilter.ref };
    }

    const whereClause = db.select(fields).from(plan.tableRef).where(condition);
    // Ordering a single aggregate row is meaningless (and Postgres rejects an ORDER BY
    // referencing a column that isn't part of the aggregate/GROUP BY, e.g.
    // `select sum("amount") ... order by "id" desc` errors with 42803) — skip .orderBy()
    // whenever aggregation is set, even if the descriptor also asked for a sort.
    const ordered = plan.sort && !plan.aggregation
      ? whereClause.orderBy(plan.sort.direction === 'desc' ? desc(plan.sort.ref as any) : asc(plan.sort.ref as any))
      : whereClause;

    // plan.limit is always present (never optional) — this is the row cap that must be
    // applied on every query, with no exceptions, including aggregation queries.
    return ordered.limit(plan.limit);
  };
}
