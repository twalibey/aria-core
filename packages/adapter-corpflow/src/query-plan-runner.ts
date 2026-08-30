import { and, eq, gt, gte, lt, lte, inArray, sql, type SQL } from 'drizzle-orm';
import type { ResolvedQueryPlan, QueryPlanRunner } from '@aria/core';

// Minimal shape of what this runner needs from a Drizzle db instance —
// avoids depending on a specific Drizzle driver (postgres-js, node-postgres, etc.).
export interface DrizzleQueryable {
  select: (fields?: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (condition: SQL) => Promise<Record<string, unknown>[]>;
    };
  };
}

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

export function createDrizzleQueryPlanRunner(db: DrizzleQueryable): QueryPlanRunner {
  return async (plan: ResolvedQueryPlan) => {
    const tenantCondition = eq(plan.tenantFilter.ref as any, plan.tenantFilter.value);
    const otherConditions = plan.filters.map(buildFilterCondition);
    const condition = otherConditions.length > 0 ? and(tenantCondition, ...otherConditions)! : tenantCondition;

    return db.select().from(plan.tableRef).where(condition);
  };
}
