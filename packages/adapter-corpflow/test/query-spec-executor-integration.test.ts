import { describe, it, expect, vi } from 'vitest';
import { pgTable, text, integer } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { QuerySpecExecutor, SecurityAuditLog } from '@aria/core';
import type { QueryWhitelist } from '@aria/core';
import { createDrizzleQueryPlanRunner, AGGREGATION_RESULT_KEY } from '../src/query-plan-runner';

/**
 * End-to-end proof that QuerySpecExecutor's resolved plan, once handed to a
 * REAL createDrizzleQueryPlanRunner wired to a REAL drizzle-orm pg-core table,
 * produces the real SQL a database would actually receive — not a mock chain
 * standing in for one.
 *
 * Every other test in this codebase mocks one side of this boundary:
 *   - packages/core/test/query-spec-executor.test.ts uses vi.fn() runners
 *   - packages/adapter-corpflow/test/query-plan-runner.test.ts hand-builds
 *     ResolvedQueryPlan literals and a hand-mocked db chain, rather than
 *     getting a plan from a real executor or a real drizzle SQL compiler
 *   - the live-model smoke test script never touches @aria/adapter-corpflow
 *     at all
 *
 * This test closes that gap using `drizzle-orm/pg-proxy`: a real drizzle db
 * backed by a callback instead of a live network connection. The callback
 * receives the actual compiled SQL string and bound params exactly as a real
 * Postgres driver would, right as the query plan runner's own `.limit()`
 * (or aggregation `.limit()`) call executes — this is the real drizzle SQL
 * compiler and query builder, not a hand-rolled fixture.
 *
 * Caveat: `@aria/core`'s import above resolves through node_modules, which —
 * per packages/core/README.md's git-tag drift note — is a fetched copy of
 * whatever `core-vX` tag this package's own package.json currently pins, not
 * automatically this monorepo's live `packages/core/src`. So this test does
 * prove the real SQL-rendering seam described above, but it only proves
 * `QuerySpecExecutor` behaves as the PINNED core release does; a change to
 * `packages/core/src` that hasn't been re-tagged and re-installed yet is
 * invisible here until that happens.
 */

const donations = pgTable('donations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  amount: integer('amount').notNull(),
  category: text('category').notNull(),
});

const whitelist: QueryWhitelist = {
  tables: {
    donations: {
      tableRef: donations,
      columns: {
        id: { ref: donations.id },
        amount: { ref: donations.amount },
        category: { ref: donations.category },
        tenant_id: { ref: donations.tenantId },
      },
      tenantColumnKey: 'tenant_id',
      aggregations: ['sum', 'count', 'avg'],
      sortableColumns: ['amount'],
    },
  },
};

function makeAuditLog() {
  const store = vi.fn().mockResolvedValue(undefined);
  const onCriticalViolation = vi.fn();
  return new SecurityAuditLog({ store, onCriticalViolation });
}

/** Builds a real drizzle-orm db (via the pg-proxy driver) that captures the
 * real compiled SQL + bound params of whatever query it is asked to run,
 * instead of hitting a real Postgres connection. `rows` must be given in the
 * proxy driver's real wire shape — positional arrays (one value per selected
 * field, in select order), matching what a real `pg` driver's row-array mode
 * returns — which drizzle then maps back onto the field names itself. */
function makeCapturingDb(rows: unknown[][] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = drizzle(async (sql, params) => {
    calls.push({ sql, params });
    return { rows };
  });
  return { db, calls };
}

describe('QuerySpecExecutor + createDrizzleQueryPlanRunner (real end-to-end)', () => {
  it('emits real SQL that selects only the whitelisted columns, enforces the tenant filter, and applies a limit', async () => {
    const { db, calls } = makeCapturingDb([['d1', 100]]);
    const runner = createDrizzleQueryPlanRunner(db as any);
    const executor = new QuerySpecExecutor({ whitelist, runner, securityAuditLog: makeAuditLog() });

    const result = await executor.execute(
      { table: 'donations', columns: ['id', 'amount'] },
      { tenantId: 'tenant-1' }
    );

    expect(result.success).toBe(true);
    expect(result.rows).toEqual([{ id: 'd1', amount: 100 }]);
    expect(calls).toHaveLength(1);
    const { sql, params } = calls[0];

    // Only the whitelisted columns requested — never SELECT *, and never a
    // column not asked for (e.g. "category" must not appear).
    expect(sql).toMatch(/^select "id", "amount" from "donations"/);
    expect(sql).not.toContain('*');
    expect(sql).not.toContain('"category"');

    // A real WHERE clause enforcing the tenant filter on the tenant_id column,
    // bound as a parameter (never inlined into the SQL string).
    expect(sql).toContain('where "donations"."tenant_id" = $1');
    expect(params[0]).toBe('tenant-1');

    // A real LIMIT clause, bound as a parameter.
    expect(sql).toMatch(/limit \$2/);
    expect(params[1]).toBe(100); // QuerySpecExecutor's default limit
  });

  it('emits real SQL using the correct aggregate function and the AGGREGATION_RESULT_KEY-keyed output shape', async () => {
    const { db, calls } = makeCapturingDb([['250']]);
    const runner = createDrizzleQueryPlanRunner(db as any);
    const executor = new QuerySpecExecutor({ whitelist, runner, securityAuditLog: makeAuditLog() });

    const result = await executor.execute(
      { table: 'donations', columns: [], aggregation: { fn: 'avg', column: 'amount' } },
      { tenantId: 'tenant-2' }
    );

    expect(result.success).toBe(true);
    expect(result.rows).toEqual([{ [AGGREGATION_RESULT_KEY]: '250' }]);

    expect(calls).toHaveLength(1);
    const { sql, params } = calls[0];

    // The real avg() SQL function operating on the resolved amount column —
    // proving the {key, ref} column-descriptor pairing and the aggregation
    // function selection both flow correctly from descriptor -> resolved plan
    // -> real drizzle query. (Drizzle only emits an explicit `as "result"`
    // alias when the projection has sibling fields to disambiguate against;
    // as the sole selected field here it's returned positionally instead —
    // confirmed above by the AGGREGATION_RESULT_KEY-keyed `result.rows` shape.)
    expect(sql).toMatch(/^select avg\("amount"\) from "donations"/);
    expect(sql).toContain('where "donations"."tenant_id" = $1');
    expect(params[0]).toBe('tenant-2');
  });
});
