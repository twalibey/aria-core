import { describe, it, expect, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createDrizzleAgentActionStore } from '../src/agent-action-store';

function makeTableRef() {
  return {
    id: { name: 'id' } as any,
    tenantId: { name: 'tenant_id' } as any,
    agentId: { name: 'agent_id' } as any,
    sourceType: { name: 'source_type' } as any,
    sourceId: { name: 'source_id' } as any,
    status: { name: 'status' } as any,
    draftContent: { name: 'draft_content' } as any,
    sourceSnapshot: { name: 'source_snapshot' } as any,
    attemptCount: { name: 'attempt_count' } as any,
    confirmedByUserId: { name: 'confirmed_by_user_id' } as any,
    createdAt: { name: 'created_at' } as any,
    updatedAt: { name: 'updated_at' } as any,
  };
}

function makeDb(opts: { insertReturns?: Record<string, unknown>[]; updateReturns?: Record<string, unknown>[]; selectReturns?: Record<string, unknown>[] } = {}) {
  const insertReturning = vi.fn().mockResolvedValue(opts.insertReturns ?? []);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturning = vi.fn().mockResolvedValue(opts.updateReturns ?? []);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  const selectLimit = vi.fn().mockResolvedValue(opts.selectReturns ?? []);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const db = { insert, update, select };
  return { db, insert, insertValues, onConflictDoNothing, insertReturning, update, updateSet, updateWhere, updateReturning, select, selectFrom, selectWhere, selectLimit };
}

const NOW_ROW = {
  id: 'action-1',
  tenantId: 'tenant-1',
  agentId: 'donor-response',
  sourceType: 'donation_form_submission',
  sourceId: 'sub-1',
  status: 'processing',
  draftContent: null,
  sourceSnapshot: null,
  attemptCount: 0,
  confirmedByUserId: null,
  createdAt: new Date('2026-08-31T00:00:00Z'),
  updatedAt: new Date('2026-08-31T00:00:00Z'),
};

describe('createDrizzleAgentActionStore', () => {
  describe('claim', () => {
    it('inserts a new processing row and maps snake_case columns to the AgentAction shape', async () => {
      const { db, insertValues, onConflictDoNothing } = makeDb({ insertReturns: [NOW_ROW] });
      const table = makeTableRef();
      const store = createDrizzleAgentActionStore(db as any, table);

      const action = await store.claim({
        tenantId: 'tenant-1',
        agentId: 'donor-response',
        sourceType: 'donation_form_submission',
        sourceId: 'sub-1',
      });

      expect(action).not.toBeNull();
      expect(action!.id).toBe('action-1');
      expect(action!.status).toBe('processing');
      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', agentId: 'donor-response', status: 'processing' })
      );
      expect(onConflictDoNothing).toHaveBeenCalledWith({ target: [table.sourceType, table.sourceId, table.agentId] });
    });

    it('returns null when the insert conflicts (row already claimed)', async () => {
      const { db } = makeDb({ insertReturns: [] });
      const table = makeTableRef();
      const store = createDrizzleAgentActionStore(db as any, table);

      const action = await store.claim({
        tenantId: 'tenant-1',
        agentId: 'donor-response',
        sourceType: 'donation_form_submission',
        sourceId: 'sub-1',
      });

      expect(action).toBeNull();
    });
  });

  describe('update', () => {
    it('sets the given fields, uses the real eq() operator on id, and returns the mapped row', async () => {
      const updatedRow = { ...NOW_ROW, status: 'pending_confirm', draftContent: 'hello' };
      const { db, updateSet, updateWhere } = makeDb({ updateReturns: [updatedRow] });
      const table = makeTableRef();
      const store = createDrizzleAgentActionStore(db as any, table);

      const result = await store.update('action-1', { status: 'pending_confirm', draftContent: 'hello' });

      expect(result.status).toBe('pending_confirm');
      expect(result.draftContent).toBe('hello');
      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending_confirm', draftContent: 'hello' })
      );
      expect(updateWhere).toHaveBeenCalledWith(eq(table.id, 'action-1'));
    });

    it('throws when the update matches no row', async () => {
      const { db } = makeDb({ updateReturns: [] });
      const table = makeTableRef();
      const store = createDrizzleAgentActionStore(db as any, table);

      await expect(store.update('does-not-exist', { status: 'sent' })).rejects.toThrow();
    });
  });

  describe('get', () => {
    it('returns the mapped row when found', async () => {
      const { db, selectWhere } = makeDb({ selectReturns: [NOW_ROW] });
      const table = makeTableRef();
      const store = createDrizzleAgentActionStore(db as any, table);

      const result = await store.get('action-1');

      expect(result?.id).toBe('action-1');
      expect(selectWhere).toHaveBeenCalledWith(eq(table.id, 'action-1'));
    });

    it('returns null when not found', async () => {
      const { db } = makeDb({ selectReturns: [] });
      const table = makeTableRef();
      const store = createDrizzleAgentActionStore(db as any, table);

      expect(await store.get('does-not-exist')).toBeNull();
    });
  });
});
