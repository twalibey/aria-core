import { describe, it, expect, vi } from 'vitest';
import { MemoryManager } from '../src/memory-manager';
import { InMemoryHistoryStore } from '../src/history/in-memory-store';
import type { AriaMemoryStore, AriaMemoryEntry, LLMProvider } from '../src/types';

function makeMemoryStore(): AriaMemoryStore & { saved: AriaMemoryEntry[] } {
  const saved: AriaMemoryEntry[] = [];
  let lastSummarizedAt: Date | null = null;
  return {
    saved,
    async countMessagesSince() {
      return 0;
    },
    async getLastSummarizedAt() {
      return lastSummarizedAt;
    },
    async getMemories(_userId, limit) {
      return saved.slice(-limit);
    },
    async getAllMemoryContents() {
      return saved.map((m) => m.content);
    },
    async saveMemory(_userId, entry) {
      saved.push(entry);
      lastSummarizedAt = new Date();
    },
  };
}

async function seedMessages(historyStore: InMemoryHistoryStore, userId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await historyStore.saveMessage(userId, { role: i % 2 === 0 ? 'user' : 'assistant', content: `msg ${i}` });
  }
}

describe('MemoryManager.maybeSummarize', () => {
  it('does nothing when fewer than minMessagesToTrigger messages exist', async () => {
    const historyStore = new InMemoryHistoryStore();
    await seedMessages(historyStore, 'u1', 5);
    const memoryStore = makeMemoryStore();
    const summarizerProvider: LLMProvider = { call: vi.fn() };
    const manager = new MemoryManager({ extractionPrompt: 'x', summarizerProvider, historyStore, memoryStore });

    await manager.maybeSummarize('u1');

    expect(summarizerProvider.call).not.toHaveBeenCalled();
    expect(memoryStore.saved).toHaveLength(0);
  });

  it('summarizes and saves extracted memories when the message threshold is met', async () => {
    const historyStore = new InMemoryHistoryStore();
    await seedMessages(historyStore, 'u1', 10);
    const memoryStore = makeMemoryStore();
    const summarizerProvider: LLMProvider = {
      async call() {
        return { content: JSON.stringify([{ type: 'goal', content: 'Training for a 10k' }]) };
      },
    };
    const manager = new MemoryManager({ extractionPrompt: 'x', summarizerProvider, historyStore, memoryStore });

    await manager.maybeSummarize('u1');

    expect(memoryStore.saved).toHaveLength(1);
    expect(memoryStore.saved[0]).toMatchObject({ memoryType: 'goal', content: 'Training for a 10k' });
  });

  it('falls back to conversation_summary for an unrecognized memory type', async () => {
    const historyStore = new InMemoryHistoryStore();
    await seedMessages(historyStore, 'u1', 10);
    const memoryStore = makeMemoryStore();
    const summarizerProvider: LLMProvider = {
      async call() {
        return { content: JSON.stringify([{ type: 'bogus_type', content: 'Something noteworthy' }]) };
      },
    };
    const manager = new MemoryManager({ extractionPrompt: 'x', summarizerProvider, historyStore, memoryStore });

    await manager.maybeSummarize('u1');

    expect(memoryStore.saved[0].memoryType).toBe('conversation_summary');
  });

  it('skips saving a memory whose content case-insensitively matches an existing one', async () => {
    const historyStore = new InMemoryHistoryStore();
    await seedMessages(historyStore, 'u1', 10);
    const memoryStore = makeMemoryStore();
    memoryStore.saved.push({ memoryType: 'goal', content: 'Training for a 10K', sourceDate: new Date() });
    const summarizerProvider: LLMProvider = {
      async call() {
        return { content: JSON.stringify([{ type: 'goal', content: 'training for a 10k' }]) };
      },
    };
    const manager = new MemoryManager({ extractionPrompt: 'x', summarizerProvider, historyStore, memoryStore });

    await manager.maybeSummarize('u1');

    expect(memoryStore.saved).toHaveLength(1);
  });

  it('bails when a memory already exists and fewer than minMessagesToTrigger messages arrived since', async () => {
    const historyStore = new InMemoryHistoryStore();
    await seedMessages(historyStore, 'u1', 10);
    const memoryStore = makeMemoryStore();
    memoryStore.saved.push({ memoryType: 'goal', content: 'existing', sourceDate: new Date() });
    (memoryStore.getLastSummarizedAt as any) = async () => new Date();
    memoryStore.countMessagesSince = async () => 3; // below the default threshold of 10
    const summarizerProvider: LLMProvider = { call: vi.fn() };
    const manager = new MemoryManager({ extractionPrompt: 'x', summarizerProvider, historyStore, memoryStore });

    await manager.maybeSummarize('u1');

    expect(summarizerProvider.call).not.toHaveBeenCalled();
  });

  it('never throws — internal errors are reported via onError instead', async () => {
    const historyStore = new InMemoryHistoryStore();
    await seedMessages(historyStore, 'u1', 10);
    const memoryStore = makeMemoryStore();
    const summarizerProvider: LLMProvider = {
      async call() {
        throw new Error('provider down');
      },
    };
    const seen: { userId: string; error: Error }[] = [];
    const manager = new MemoryManager({
      extractionPrompt: 'x',
      summarizerProvider,
      historyStore,
      memoryStore,
      onError: (params) => seen.push(params),
    });

    await expect(manager.maybeSummarize('u1')).resolves.toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(seen[0].userId).toBe('u1');
  });

  it('routes a JSON.parse failure to onError and saves nothing', async () => {
    const historyStore = new InMemoryHistoryStore();
    await seedMessages(historyStore, 'u1', 10);
    const memoryStore = makeMemoryStore();
    const summarizerProvider: LLMProvider = {
      async call() {
        return { content: '```json\n[{"type": "goal", "content": "malformed"}]\n```' };
      },
    };
    const seen: { userId: string; error: Error }[] = [];
    const manager = new MemoryManager({
      extractionPrompt: 'x',
      summarizerProvider,
      historyStore,
      memoryStore,
      onError: (params) => seen.push(params),
    });

    await manager.maybeSummarize('u1');

    expect(seen).toHaveLength(1);
    expect(seen[0].userId).toBe('u1');
    expect(memoryStore.saved).toHaveLength(0);
  });

  it('guards against overlapping calls for the same user', async () => {
    const historyStore = new InMemoryHistoryStore();
    await seedMessages(historyStore, 'u1', 10);
    const memoryStore = makeMemoryStore();
    let callCount = 0;
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const summarizerProvider: LLMProvider = {
      async call() {
        callCount++;
        await gate;
        return { content: '[]' };
      },
    };
    const manager = new MemoryManager({ extractionPrompt: 'x', summarizerProvider, historyStore, memoryStore });

    const first = manager.maybeSummarize('u1');
    const second = manager.maybeSummarize('u1'); // should be a no-op, first is still in flight
    releaseFirst();
    await Promise.all([first, second]);

    expect(callCount).toBe(1);
  });
});

describe('MemoryManager.buildMemoryPromptSection', () => {
  it('returns an empty string when there are no memories', async () => {
    const historyStore = new InMemoryHistoryStore();
    const memoryStore = makeMemoryStore();
    const manager = new MemoryManager({
      extractionPrompt: 'x',
      summarizerProvider: { call: vi.fn() },
      historyStore,
      memoryStore,
    });

    expect(await manager.buildMemoryPromptSection('u1')).toBe('');
  });

  it('renders memories into the WHAT YOU REMEMBER section', async () => {
    const historyStore = new InMemoryHistoryStore();
    const memoryStore = makeMemoryStore();
    memoryStore.saved.push({
      memoryType: 'goal',
      content: 'Training for a 10k',
      sourceDate: new Date('2026-01-01'),
    });
    const manager = new MemoryManager({
      extractionPrompt: 'x',
      summarizerProvider: { call: vi.fn() },
      historyStore,
      memoryStore,
    });

    const section = await manager.buildMemoryPromptSection('u1');

    expect(section).toContain('## WHAT YOU REMEMBER FROM PAST CONVERSATIONS');
    expect(section).toContain('[goal] Training for a 10k');
  });
});
