import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryHistoryStore } from '../../src/history/in-memory-store';

describe('InMemoryHistoryStore', () => {
  let store: InMemoryHistoryStore;

  beforeEach(() => {
    store = new InMemoryHistoryStore();
  });

  it('saves and retrieves messages in order', async () => {
    await store.saveMessage('u1', { role: 'user', content: 'hi' });
    await store.saveMessage('u1', { role: 'assistant', content: 'hello' });
    const messages = await store.getRecentMessages('u1', 10);
    expect(messages.map((m) => m.content)).toEqual(['hi', 'hello']);
  });

  it('limits results to the requested count, keeping the most recent', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveMessage('u1', { role: 'user', content: `msg${i}` });
    }
    const messages = await store.getRecentMessages('u1', 2);
    expect(messages.map((m) => m.content)).toEqual(['msg3', 'msg4']);
  });

  it('keeps different users isolated', async () => {
    await store.saveMessage('u1', { role: 'user', content: 'from u1' });
    await store.saveMessage('u2', { role: 'user', content: 'from u2' });
    expect((await store.getRecentMessages('u1', 10)).map((m) => m.content)).toEqual(['from u1']);
    expect((await store.getRecentMessages('u2', 10)).map((m) => m.content)).toEqual(['from u2']);
  });

  it('clears messages for a user', async () => {
    await store.saveMessage('u1', { role: 'user', content: 'hi' });
    await store.clearMessages('u1');
    expect(await store.getRecentMessages('u1', 10)).toEqual([]);
  });

  it('counts messages since a given date, optionally filtered by role', async () => {
    const before = new Date();
    await new Promise((r) => setTimeout(r, 5));
    await store.saveMessage('u1', { role: 'user', content: 'a' });
    await store.saveMessage('u1', { role: 'assistant', content: 'b' });
    expect(await store.countMessagesSince('u1', before)).toBe(2);
    expect(await store.countMessagesSince('u1', before, 'user')).toBe(1);
  });
});
