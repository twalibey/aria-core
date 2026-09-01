import { eq, type SQL } from 'drizzle-orm';
import type { AgentAction, AgentActionStore } from '@aria/core';

// Minimal shape of what this store needs from a Drizzle db instance — avoids
// depending on a specific Drizzle driver, mirroring query-plan-runner.ts's
// DrizzleQueryable pattern. Modeled on the exact chains this store calls:
//   db.insert(table).values(v).onConflictDoNothing({target}).returning()
//   db.update(table).set(v).where(cond).returning()
//   db.select().from(table).where(cond).limit(n)
export interface DrizzleAgentActionQueryable {
  insert: (table: unknown) => {
    values: (vals: Record<string, unknown>) => {
      onConflictDoNothing: (opts: { target: unknown[] }) => {
        returning: () => Promise<Record<string, unknown>[]>;
      };
    };
  };
  update: (table: unknown) => {
    set: (vals: Record<string, unknown>) => {
      where: (condition: SQL) => {
        returning: () => Promise<Record<string, unknown>[]>;
      };
    };
  };
  select: () => {
    from: (table: unknown) => {
      where: (condition: SQL) => {
        limit: (n: number) => Promise<Record<string, unknown>[]>;
      };
    };
  };
}

// Column refs CorpFlow's real agent_actions table must supply — no CorpFlow
// schema knowledge lives in this package, only these named references.
export interface AgentActionsTableRef {
  id: unknown;
  tenantId: unknown;
  agentId: unknown;
  sourceType: unknown;
  sourceId: unknown;
  status: unknown;
  draftContent: unknown;
  sourceSnapshot: unknown;
  attemptCount: unknown;
  confirmedByUserId: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

function rowToAction(row: Record<string, unknown>): AgentAction {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    agentId: row.agent_id as string,
    sourceType: row.source_type as string,
    sourceId: row.source_id as string,
    status: row.status as AgentAction['status'],
    draftContent: (row.draft_content as string | null) ?? null,
    sourceSnapshot: (row.source_snapshot as Record<string, unknown> | null) ?? null,
    attemptCount: row.attempt_count as number,
    confirmedByUserId: (row.confirmed_by_user_id as string | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export function createDrizzleAgentActionStore(
  db: DrizzleAgentActionQueryable,
  table: AgentActionsTableRef
): AgentActionStore {
  return {
    async claim(params) {
      const rows = await db
        .insert(table)
        .values({
          tenant_id: params.tenantId,
          agent_id: params.agentId,
          source_type: params.sourceType,
          source_id: params.sourceId,
          status: 'processing',
        })
        .onConflictDoNothing({ target: [table.sourceType, table.sourceId, table.agentId] })
        .returning();

      return rows.length > 0 ? rowToAction(rows[0]) : null;
    },

    async update(id, patch) {
      const values: Record<string, unknown> = {};
      if ('status' in patch) values.status = patch.status;
      if ('draftContent' in patch) values.draft_content = patch.draftContent;
      if ('sourceSnapshot' in patch) values.source_snapshot = patch.sourceSnapshot;
      if ('attemptCount' in patch) values.attempt_count = patch.attemptCount;
      if ('confirmedByUserId' in patch) values.confirmed_by_user_id = patch.confirmedByUserId;

      const rows = await db
        .update(table)
        .set(values)
        .where(eq(table.id as any, id))
        .returning();

      if (rows.length === 0) throw new Error(`AgentAction not found: ${id}`);
      return rowToAction(rows[0]);
    },

    async get(id) {
      const rows = await db
        .select()
        .from(table)
        .where(eq(table.id as any, id))
        .limit(1);

      return rows.length > 0 ? rowToAction(rows[0]) : null;
    },
  };
}
