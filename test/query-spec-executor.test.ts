import { describe, it, expect, vi } from 'vitest';
import { QuerySpecExecutor } from '../src/query-spec-executor';
import { SecurityAuditLog } from '../src/security-audit-log';
import type { QueryWhitelist, ResolvedQueryPlan } from '../src/types';

function makeWhitelist(): QueryWhitelist {
  return {
    tables: {
      donations: {
        tableRef: 'donations-table',
        columns: {
          id: { ref: 'donations.id' },
          amount: { ref: 'donations.amount' },
          tenant_id: { ref: 'donations.tenant_id' },
        },
        tenantColumnKey: 'tenant_id',
        aggregations: ['sum', 'count'],
        sortableColumns: ['amount'],
      },
    },
  };
}

function makeAuditLog() {
  const store = vi.fn().mockResolvedValue(undefined);
  const onCriticalViolation = vi.fn();
  return { log: new SecurityAuditLog({ store, onCriticalViolation }), store };
}

describe('QuerySpecExecutor', () => {
  it('executes a valid descriptor and always includes the forced tenant filter in the plan handed to the runner', async () => {
    const { log } = makeAuditLog();
    let capturedPlan: ResolvedQueryPlan | undefined;
    const runner = vi.fn(async (plan: ResolvedQueryPlan) => {
      capturedPlan = plan;
      return [{ amount: 100 }];
    });
    const executor = new QuerySpecExecutor({ whitelist: makeWhitelist(), runner, securityAuditLog: log });

    const result = await executor.execute(
      { table: 'donations', columns: ['id', 'amount'] },
      { tenantId: 'tenant-1' }
    );

    expect(result).toEqual({ success: true, rows: [{ amount: 100 }] });
    expect(capturedPlan?.tenantFilter).toEqual({ ref: 'donations.tenant_id', value: 'tenant-1' });
    expect(capturedPlan?.tableRef).toBe('donations-table');
  });

  it('rejects a non-whitelisted table and logs a violation, without calling the runner', async () => {
    const { log, store } = makeAuditLog();
    const runner = vi.fn();
    const executor = new QuerySpecExecutor({ whitelist: makeWhitelist(), runner, securityAuditLog: log });

    const result = await executor.execute(
      { table: 'internal_secrets', columns: ['id'] },
      { tenantId: 'tenant-1' }
    );

    expect(result.success).toBe(false);
    expect(runner).not.toHaveBeenCalled();
    expect(store).toHaveBeenCalledWith(expect.objectContaining({ category: 'non_whitelisted_field' }));
  });

  it('rejects a non-whitelisted column and logs a violation', async () => {
    const { log, store } = makeAuditLog();
    const runner = vi.fn();
    const executor = new QuerySpecExecutor({ whitelist: makeWhitelist(), runner, securityAuditLog: log });

    const result = await executor.execute(
      { table: 'donations', columns: ['id', 'ssn'] },
      { tenantId: 'tenant-1' }
    );

    expect(result.success).toBe(false);
    expect(runner).not.toHaveBeenCalled();
    expect(store).toHaveBeenCalledWith(expect.objectContaining({ category: 'non_whitelisted_field' }));
  });

  it('ignores a descriptor filter on the tenant column and logs a violation, but still executes using the real tenant', async () => {
    const { log, store } = makeAuditLog();
    let capturedPlan: ResolvedQueryPlan | undefined;
    const runner = vi.fn(async (plan: ResolvedQueryPlan) => {
      capturedPlan = plan;
      return [];
    });
    const executor = new QuerySpecExecutor({ whitelist: makeWhitelist(), runner, securityAuditLog: log });

    await executor.execute(
      {
        table: 'donations',
        columns: ['id'],
        filters: [{ column: 'tenant_id', op: 'eq', value: 'attacker-tenant' }],
      },
      { tenantId: 'tenant-1' }
    );

    expect(store).toHaveBeenCalledWith(expect.objectContaining({ category: 'llm_supplied_tenant_id' }));
    expect(capturedPlan?.tenantFilter.value).toBe('tenant-1');
    expect(capturedPlan?.filters).toEqual([]);
  });

  it('treats a filter value crafted as a SQL-injection attempt as an inert bound value, never inspecting or rejecting its content', async () => {
    const { log } = makeAuditLog();
    let capturedPlan: ResolvedQueryPlan | undefined;
    const runner = vi.fn(async (plan: ResolvedQueryPlan) => {
      capturedPlan = plan;
      return [];
    });
    const executor = new QuerySpecExecutor({ whitelist: makeWhitelist(), runner, securityAuditLog: log });

    const maliciousValue = "'; DROP TABLE donations; --";
    await executor.execute(
      { table: 'donations', columns: ['id'], filters: [{ column: 'amount', op: 'eq', value: maliciousValue }] },
      { tenantId: 'tenant-1' }
    );

    // The value passes through completely unmodified as data, in a `ref`-keyed
    // object the runner must bind as a parameter — it is never string-built here.
    expect(capturedPlan?.filters).toEqual([{ ref: 'donations.amount', op: 'eq', value: maliciousValue }]);
  });

  it('rejects a non-whitelisted aggregation', async () => {
    const { log } = makeAuditLog();
    const runner = vi.fn();
    const executor = new QuerySpecExecutor({ whitelist: makeWhitelist(), runner, securityAuditLog: log });

    const result = await executor.execute(
      { table: 'donations', columns: [], aggregation: { fn: 'avg', column: 'amount' } },
      { tenantId: 'tenant-1' }
    );

    expect(result.success).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects sorting by a non-sortable column', async () => {
    const { log } = makeAuditLog();
    const runner = vi.fn();
    const executor = new QuerySpecExecutor({ whitelist: makeWhitelist(), runner, securityAuditLog: log });

    const result = await executor.execute(
      { table: 'donations', columns: ['id'], sort: { column: 'id', direction: 'asc' } },
      { tenantId: 'tenant-1' }
    );

    expect(result.success).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it('caps limit at maxLimit and never surfaces a raw runner error', async () => {
    const { log } = makeAuditLog();
    const runner = vi.fn().mockRejectedValue(new Error('relation "donations" leaked schema detail'));
    const executor = new QuerySpecExecutor({
      whitelist: makeWhitelist(),
      runner,
      securityAuditLog: log,
      maxLimit: 50,
    });

    const result = await executor.execute(
      { table: 'donations', columns: ['id'], limit: 9999 },
      { tenantId: 'tenant-1' }
    );

    expect(result).toEqual({
      success: false,
      error: "I couldn't safely answer that — try rephrasing your question.",
    });
  });
});
