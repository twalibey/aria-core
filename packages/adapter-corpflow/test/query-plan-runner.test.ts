import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ResolvedQueryPlan } from '@aria/core';
import { createDrizzleQueryPlanRunner } from '../src/query-plan-runner';

describe('createDrizzleQueryPlanRunner', () => {
  it('always applies plan.tenantFilter as part of the WHERE condition, using the real eq() operator', async () => {
    const fakeColumn = { name: 'tenant_id' } as any;
    const capturedConditions: unknown[] = [];

    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn((condition: unknown) => {
        capturedConditions.push(condition);
        return Promise.resolve([{ id: 'row-1' }]);
      }),
    };
    const db = { select: vi.fn().mockReturnValue(chain) };

    const runner = createDrizzleQueryPlanRunner(db as any);
    const tableRef = { name: 'donations' } as any;
    const plan: ResolvedQueryPlan = {
      table: 'donations',
      tableRef,
      columns: [{ name: 'id' } as any],
      filters: [],
      tenantFilter: { ref: fakeColumn, value: 'tenant-1' },
      limit: 10,
    };

    const rows = await runner(plan);

    expect(rows).toEqual([{ id: 'row-1' }]);
    expect(chain.from).toHaveBeenCalledWith(tableRef);
    // The real eq() call produces a structurally identical condition object —
    // comparing against it (not a string or a mock) proves the runner used
    // the actual tenant column ref and value, not something it fabricated.
    expect(capturedConditions[0]).toEqual(eq(fakeColumn, 'tenant-1'));
  });

  it('ANDs additional filters onto the tenant filter rather than replacing it', async () => {
    const tenantColumn = { name: 'tenant_id' } as any;
    const amountColumn = { name: 'amount' } as any;
    const capturedConditions: unknown[] = [];

    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn((condition: unknown) => {
        capturedConditions.push(condition);
        return Promise.resolve([]);
      }),
    };
    const db = { select: vi.fn().mockReturnValue(chain) };

    const runner = createDrizzleQueryPlanRunner(db as any);
    const plan: ResolvedQueryPlan = {
      table: 'donations',
      tableRef: { name: 'donations' } as any,
      columns: [amountColumn],
      filters: [{ ref: amountColumn, op: 'gte', value: 100 }],
      tenantFilter: { ref: tenantColumn, value: 'tenant-1' },
      limit: 10,
    };

    await runner(plan);

    // Both the tenant predicate and the extra filter must be present —
    // proven by checking the condition is an AND of both, not just the count.
    const { and, eq: eqOp, gte } = await import('drizzle-orm');
    expect(capturedConditions[0]).toEqual(
      and(eqOp(tenantColumn, 'tenant-1'), gte(amountColumn, 100))
    );
  });
});
