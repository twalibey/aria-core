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
    tenantId: row.tenantId as string,
    agentId: row.agentId as string,
    sourceType: row.sourceType as string,
    sourceId: row.sourceId as string,
    status: row.status as AgentAction['status'],
    draftContent: (row.draftContent as string | null) ?? null,
    sourceSnapshot: (row.sourceSnapshot as Record<string, unknown> | null) ?? null,
    attemptCount: row.attemptCount as number,
    confirmedByUserId: (row.confirmedByUserId as string | null) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
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
          tenantId: params.tenantId,
          agentId: params.agentId,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
          status: 'processing',
        })
        .onConflictDoNothing({ target: [table.sourceType, table.sourceId, table.agentId] })
        .returning();

      return rows.length > 0 ? rowToAction(rows[0]) : null;
    },

    async update(id, patch) {
      const values: Record<string, unknown> = {};
      if ('status' in patch) values.status = patch.status;
      if ('draftContent' in patch) values.draftContent = patch.draftContent;
      if ('sourceSnapshot' in patch) values.sourceSnapshot = patch.sourceSnapshot;
      if ('attemptCount' in patch) values.attemptCount = patch.attemptCount;
      if ('confirmedByUserId' in patch) values.confirmedByUserId = patch.confirmedByUserId;

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
