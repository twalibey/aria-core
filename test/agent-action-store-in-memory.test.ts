import { describe, it, expect } from 'vitest';
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
