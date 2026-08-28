import { MemoryManager } from '@aria/core';
import type { AriaHistoryStore, AriaMemoryStore, AriaMemoryEntry, LLMProvider } from '@aria/core';

class InMemoryMemoryStore implements AriaMemoryStore {
  private memories = new Map<string, AriaMemoryEntry[]>();
  private lastSummarizedAt = new Map<string, Date>();

  constructor(private historyStore: AriaHistoryStore) {}

  async countMessagesSince(userId: string, since: Date): Promise<number> {
    return this.historyStore.countMessagesSince(userId, since);
  }

  async getLastSummarizedAt(userId: string): Promise<Date | null> {
    return this.lastSummarizedAt.get(userId) ?? null;
  }

  async getMemories(userId: string, limit: number): Promise<AriaMemoryEntry[]> {
    return (this.memories.get(userId) ?? []).slice(-limit);
  }

  async getAllMemoryContents(userId: string): Promise<string[]> {
    return (this.memories.get(userId) ?? []).map((m) => m.content);
  }

  async saveMemory(userId: string, entry: AriaMemoryEntry): Promise<void> {
    const existing = this.memories.get(userId) ?? [];
    existing.push(entry);
    this.memories.set(userId, existing);
    this.lastSummarizedAt.set(userId, new Date());
  }
}

export function createExampleMemory(
  historyStore: AriaHistoryStore,
  summarizerProvider: LLMProvider
): MemoryManager {
  return new MemoryManager({
    extractionPrompt:
      'Analyze this conversation between a user and a habit-tracking assistant. Extract goals, struggles, and preferences as a JSON array of {"type", "content"} objects. Return ONLY valid JSON.',
    summarizerProvider,
    historyStore,
    memoryStore: new InMemoryMemoryStore(historyStore),
  });
}
