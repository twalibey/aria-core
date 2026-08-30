import { describe, it, expect, vi } from 'vitest';
import { eq, and, count, sum, asc, desc } from 'drizzle-orm';
import type { ResolvedQueryPlan } from '@aria/core';
import {
  createDrizzleQueryPlanRunner,
  AGGREGATION_RESULT_KEY,
  MALFORMED_PLAN_FALLBACK_KEY,
} from '../src/query-plan-runner';

/**
 * Builds a fake `DrizzleQueryable` whose chain mirrors the real one:
 * select(fields).from(table).where(condition)[.orderBy(...)].limit(n)
 * Every stage is captured so tests can assert on exactly what was passed.
 */
function makeDb(rows: Record<string, unknown>[] = []) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  const db = { select };
  return { db, select, from, where, orderBy, limit };
}

describe('createDrizzleQueryPlanRunner', () => {
  it('always applies plan.tenantFilter as part of the WHERE condition, using the real eq() operator', async () => {
    const fakeColumn = { name: 'tenant_id' } as any;
    const { db, from, where, limit } = makeDb([{ id: 'row-1' }]);

    const runner = createDrizzleQueryPlanRunner(db as any);
    const tableRef = { name: 'donations' } as any;
    const idRef = { name: 'id' } as any;
    const plan: ResolvedQueryPlan = {
      table: 'donations',
      tableRef,
      columns: [{ key: 'id', ref: idRef }],
      filters: [],
      tenantFilter: { ref: fakeColumn, value: 'tenant-1' },
      limit: 10,
    };

    const rows = await runner(plan);

    expect(rows).toEqual([{ id: 'row-1' }]);
    expect(from).toHaveBeenCalledWith(tableRef);
    // The real eq() call produces a structurally identical condition object —
    // comparing against it (not a string or a mock) proves the runner used
    // the actual tenant column ref and value, not something it fabricated.
    expect(where).toHaveBeenCalledWith(eq(fakeColumn, 'tenant-1'));
    expect(limit).toHaveBeenCalledWith(10);
  });

  it('ANDs additional filters onto the tenant filter rather than replacing it', async () => {
    const tenantColumn = { name: 'tenant_id' } as any;
    const amountColumn = { name: 'amount' } as any;
    const { db, where } = makeDb([]);

    const runner = createDrizzleQueryPlanRunner(db as any);
    const plan: ResolvedQueryPlan = {
      table: 'donations',
      tableRef: { name: 'donations' } as any,
      columns: [{ key: 'amount', ref: amountColumn }],
      filters: [{ ref: amountColumn, op: 'gte', value: 100 }],
      tenantFilter: { ref: tenantColumn, value: 'tenant-1' },
      limit: 10,
    };

    await runner(plan);

    // Both the tenant predicate and the extra filter must be present —
    // proven by checking the condition is an AND of both, not just the count.
    const { eq: eqOp, gte } = await import('drizzle-orm');
    expect(where).toHaveBeenCalledWith(and(eqOp(tenantColumn, 'tenant-1'), gte(amountColumn, 100)));
  });

  it('projects exactly the whitelisted columns requested, by key, instead of SELECT *', async () => {
    const tenantColumn = { name: 'tenant_id' } as any;
    const idRef = { name: 'id' } as any;
    const categoryRef = { name: 'category' } as any;
    const { db, select } = makeDb([{ id: '1', category: 'invoice' }]);

    const runner = createDrizzleQueryPlanRunner(db as any);
    const plan: ResolvedQueryPlan = {
      table: 'documents',
      tableRef: { name: 'documents' } as any,
      columns: [
        { key: 'id', ref: idRef },
        { key: 'category', ref: categoryRef },
      ],
      filters: [],
      tenantFilter: { ref: tenantColumn, value: 'tenant-1' },
      limit: 50,
    };

    await runner(plan);

    // The exact field map passed to select() must match the whitelist-validated
    // columns the caller asked for — not every column on the row.
    expect(select).toHaveBeenCalledWith({ id: idRef, category: categoryRef });
  });

  it('builds a real count() aggregation and returns it under the documented result key, ignoring columns', async () => {
    const tenantColumn = { name: 'tenant_id' } as any;
    const amountRef = { name: 'amount' } as any;
    const { db, select } = makeDb([{ [AGGREGATION_RESULT_KEY]: 7 }]);

    const runner = createDrizzleQueryPlanRunner(db as any);
    const plan: ResolvedQueryPlan = {
      table: 'donations',
      tableRef: { name: 'donations' } as any,
      // Columns present but must be ignored once aggregation is set.
      columns: [{ key: 'id', ref: { name: 'id' } as any }],
      filters: [],
      tenantFilter: { ref: tenantColumn, value: 'tenant-1' },
      aggregation: { fn: 'count', ref: amountRef },
      limit: 100,
    };

    const rows = await runner(plan);

    expect(select).toHaveBeenCalledWith({ [AGGREGATION_RESULT_KEY]: count(amountRef) });
    expect(rows).toEqual([{ [AGGREGATION_RESULT_KEY]: 7 }]);
  });

  it('builds a real sum() aggregation', async () => {
    const tenantColumn = { name: 'tenant_id' } as any;
    const amountRef = { name: 'amount' } as any;
    const { db, select } = makeDb([]);

    const runner = createDrizzleQueryPlanRunner(db as any);
    const plan: ResolvedQueryPlan = {
      table: 'donations',
      tableRef: { name: 'donations' } as any,
      columns: [],
      filters: [],
      tenantFilter: { ref: tenantColumn, value: 'tenant-1' },
      aggregation: { fn: 'sum', ref: amountRef },
      limit: 100,
    };

    await runner(plan);

    expect(select).toHaveBeenCalledWith({ [AGGREGATION_RESULT_KEY]: sum(amountRef) });
  });

  it.each([
    ['desc', desc] as const,
    ['asc', asc] as const,
  ])('applies .orderBy() with the real %s() operator', async (direction, operator) => {
    const tenantColumn = { name: 'tenant_id' } as any;
    const amountRef = { name: 'amount' } as any;
    const { db, orderBy } = makeDb([]);

    const runner = createDrizzleQueryPlanRunner(db as any);
    const plan: ResolvedQueryPlan = {
      table: 'donations',
      tableRef: { name: 'donations' } as any,
      columns: [{ key: 'amount', ref: amountRef }],
      filters: [],
      tenantFilter: { ref: tenantColumn, value: 'tenant-1' },
      sort: { ref: amountRef, direction },
      limit: 20,
    };

    await runner(plan);

    expect(orderBy).toHaveBeenCalledWith(operator(amountRef));
  });

  it('applies .limit() on every query, even when no sort is present', async () => {
    const tenantColumn = { name: 'tenant_id' } as any;
    const { db, limit, orderBy } = makeDb([]);

    const runner = createDrizzleQueryPlanRunner(db as any);
    const plan: ResolvedQueryPlan = {
      table: 'donations',
      tableRef: { name: 'donations' } as any,
      columns: [{ key: 'id', ref: { name: 'id' } as any }],
      filters: [],
      tenantFilter: { ref: tenantColumn, value: 'tenant-1' },
      limit: 42,
    };

    await runner(plan);

    expect(limit).toHaveBeenCalledWith(42);
    expect(orderBy).not.toHaveBeenCalled();
  });

  it('never falls back to SELECT * when a plan has neither columns nor an aggregation — projects only the tenant column', async () => {
    const tenantColumn = { name: 'tenant_id' } as any;
    const { db, select, limit } = makeDb([]);

    const runner = createDrizzleQueryPlanRunner(db as any);
    const plan: ResolvedQueryPlan = {
      table: 'donations',
      tableRef: { name: 'donations' } as any,
      columns: [],
      filters: [],
      tenantFilter: { ref: tenantColumn, value: 'tenant-1' },
      limit: 100,
    };

    await runner(plan);

    expect(select).toHaveBeenCalledWith({ [MALFORMED_PLAN_FALLBACK_KEY]: tenantColumn });
    expect(limit).toHaveBeenCalledWith(100);
  });
});
