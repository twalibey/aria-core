import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAgentActionStore } from '../src/agent-action-store-in-memory';

describe('InMemoryAgentActionStore', () => {
  it('claim creates a new processing row on first call', async () => {
    const store = new InMemoryAgentActionStore();
    const action = await store.claim({
      tenantId: 'tenant-1',
      agentId: 'donor-response',
      sourceType: 'donation_form_submission',
      sourceId: 'sub-1',
    });
    expect(action).not.toBeNull();
    expect(action!.status).toBe('processing');
    expect(action!.attemptCount).toBe(0);
    expect(action!.tenantId).toBe('tenant-1');
  });

  it('claim returns null on a second attempt for the same (sourceType, sourceId, agentId)', async () => {
    const store = new InMemoryAgentActionStore();
    const params = {
      tenantId: 'tenant-1',
      agentId: 'donor-response',
      sourceType: 'donation_form_submission',
      sourceId: 'sub-1',
    };
    const first = await store.claim(params);
    const second = await store.claim(params);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('claim allows the same sourceId under a different agentId', async () => {
    const store = new InMemoryAgentActionStore();
    const a = await store.claim({ tenantId: 't1', agentId: 'agent-a', sourceType: 'x', sourceId: 'same' });
    const b = await store.claim({ tenantId: 't1', agentId: 'agent-b', sourceType: 'x', sourceId: 'same' });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it('update patches fields and returns the updated row', async () => {
    const store = new InMemoryAgentActionStore();
    const created = await store.claim({ tenantId: 't1', agentId: 'a', sourceType: 'x', sourceId: 's1' });
    const updated = await store.update(created!.id, { status: 'pending_confirm', draftContent: 'hello' });
    expect(updated.status).toBe('pending_confirm');
    expect(updated.draftContent).toBe('hello');
    expect(updated.id).toBe(created!.id);
  });

  it('update throws for an unknown id', async () => {
    const store = new InMemoryAgentActionStore();
    await expect(store.update('does-not-exist', { status: 'sent' })).rejects.toThrow();
  });

  it('get returns null for an unknown id', async () => {
    const store = new InMemoryAgentActionStore();
    expect(await store.get('does-not-exist')).toBeNull();
  });
});

describe('InMemoryAgentActionStore.reclaimForRetry', () => {
  let store: InMemoryAgentActionStore;

  beforeEach(() => {
    store = new InMemoryAgentActionStore();
  });

  it('reclaims a draft_failed row back to processing when under the attempt cap', async () => {
    const claimed = await store.claim({
      tenantId: 't1', agentId: 'automation:a1', sourceType: 'case', sourceId: 'c1',
    });
    expect(claimed).not.toBeNull();
    await store.update(claimed!.id, { status: 'draft_failed', attemptCount: 1 });

    const reclaimed = await store.reclaimForRetry({
      tenantId: 't1', agentId: 'automation:a1', sourceType: 'case', sourceId: 'c1', maxAttempts: 3,
    });

    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.id).toBe(claimed!.id);
    expect(reclaimed!.status).toBe('processing');
  });

  it('returns null when the row is already at the attempt cap', async () => {
    const claimed = await store.claim({
      tenantId: 't1', agentId: 'automation:a1', sourceType: 'case', sourceId: 'c2',
    });
    await store.update(claimed!.id, { status: 'draft_failed', attemptCount: 3 });

    const reclaimed = await store.reclaimForRetry({
      tenantId: 't1', agentId: 'automation:a1', sourceType: 'case', sourceId: 'c2', maxAttempts: 3,
    });

    expect(reclaimed).toBeNull();
  });

  it('returns null when no row exists for the triple', async () => {
    const reclaimed = await store.reclaimForRetry({
      tenantId: 't1', agentId: 'automation:a1', sourceType: 'case', sourceId: 'nonexistent', maxAttempts: 3,
    });
    expect(reclaimed).toBeNull();
  });

  it('returns null when the existing row is not draft_failed (e.g. still processing)', async () => {
    const claimed = await store.claim({
      tenantId: 't1', agentId: 'automation:a1', sourceType: 'case', sourceId: 'c3',
    });
    expect(claimed!.status).toBe('processing');

    const reclaimed = await store.reclaimForRetry({
      tenantId: 't1', agentId: 'automation:a1', sourceType: 'case', sourceId: 'c3', maxAttempts: 3,
    });
    expect(reclaimed).toBeNull();
  });
});
