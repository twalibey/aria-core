import { describe, it, expect } from 'vitest';
import { pgTable, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { createDrizzleAgentActionStore } from '../src/agent-action-store';

/**
 * End-to-end proof that createDrizzleAgentActionStore.reclaimForRetry compiles
 * a real conditional UPDATE against a real drizzle-orm pg-core table — not a
 * hand-mocked db chain (see test/agent-action-store.test.ts for that style,
 * used for claim/update/get). This uses `drizzle-orm/pg-proxy`, same as
 * test/query-spec-executor-integration.test.ts: a real drizzle db backed by a
 * callback instead of a live network connection, so the callback receives the
 * actual compiled SQL string and bound params exactly as a real Postgres
 * driver would.
 */

const agentActionsTable = pgTable('agent_actions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  agentId: text('agent_id').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  status: text('status').notNull(),
  draftContent: text('draft_content'),
  sourceSnapshot: jsonb('source_snapshot'),
  attemptCount: integer('attempt_count').notNull(),
  confirmedByUserId: text('confirmed_by_user_id'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

function makeCapturingDb(rows: unknown[][] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = drizzle(async (sql, params) => {
    calls.push({ sql, params });
    return { rows };
  });
  return { db, calls };
}

describe('createDrizzleAgentActionStore.reclaimForRetry (real end-to-end)', () => {
  it('compiles a conditional UPDATE that only matches draft_failed rows under the attempt cap', async () => {
    const { db, calls } = makeCapturingDb([]);
    const store = createDrizzleAgentActionStore(db as any, agentActionsTable as any);

    const result = await store.reclaimForRetry({
      tenantId: 't1',
      agentId: 'automation:a1',
      sourceType: 'case',
      sourceId: 'c1',
      maxAttempts: 3,
    });

    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
    const { sql, params } = calls[0];

    expect(sql.toLowerCase()).toContain('update');
    expect(sql.toLowerCase()).toContain('"agent_actions"');
    expect(sql).toContain('"status" = $1');
    // draft_failed is bound as a parameter, never inlined into the SQL string.
    expect(sql.toLowerCase()).toContain('attempt_count');
    expect(params).toContain('t1');
    expect(params).toContain('automation:a1');
    expect(params).toContain('case');
    expect(params).toContain('c1');
    expect(params).toContain('draft_failed');
    expect(params).toContain(3);
  });

  it('returns the mapped row when the UPDATE matches an eligible draft_failed row', async () => {
    const now = new Date('2026-09-06T00:00:00.000Z');
    const row = [
      'action-1',
      't1',
      'automation:a1',
      'case',
      'c1',
      'processing',
      null,
      null,
      1,
      null,
      now.toISOString(),
      now.toISOString(),
    ];
    const { db } = makeCapturingDb([row]);
    const store = createDrizzleAgentActionStore(db as any, agentActionsTable as any);

    const result = await store.reclaimForRetry({
      tenantId: 't1',
      agentId: 'automation:a1',
      sourceType: 'case',
      sourceId: 'c1',
      maxAttempts: 3,
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('action-1');
    expect(result!.status).toBe('processing');
  });

  it('returns null when the UPDATE matches zero rows', async () => {
    const { db } = makeCapturingDb([]);
    const store = createDrizzleAgentActionStore(db as any, agentActionsTable as any);

    const result = await store.reclaimForRetry({
      tenantId: 't1',
      agentId: 'automation:a1',
      sourceType: 'case',
      sourceId: 'c1',
      maxAttempts: 3,
    });

    expect(result).toBeNull();
  });
});
