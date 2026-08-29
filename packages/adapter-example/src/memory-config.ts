import { MemoryManager } from '@aria/core';
import type { AriaHistoryStore, AriaMemoryStore, AriaMemoryEntry, LLMProvider } from '@aria/core';

class InMemoryMemoryStore implements AriaMemoryStore {
  private memories = new Map<string, AriaMemoryEntry[]>();
  private lastSummarizedAt = new Map<string, Date>();

  constructor(private historyStore: AriaHistoryStore) {}

  async countMessagesSince(userId: string, since: Date): Promise<number> {
    // Count messages STRICTLY after `since`, not including messages at the same instant
    // 1000 is a practical upper bound for the gating check below, not a real limit — a user with
    // more unsummarized messages than this would be undercounted, but that's an acceptable edge
    // case for an in-memory demo store.
    const messages = await this.historyStore.getRecentMessages(userId, 1000);
    return messages.filter((m) => m.createdAt > since).length;
  }

  async getLastSummarizedAt(userId: string): Promise<Date | null> {
    return this.lastSummarizedAt.get(userId) ?? null;
  }

  async getMemories(userId: string, limit: number): Promise<AriaMemoryEntry[]> {
    return [...(this.memories.get(userId) ?? [])]
      .sort((a, b) => b.sourceDate.getTime() - a.sourceDate.getTime())
      .slice(0, limit);
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
  summarizerProvider: LLMProvider,
  onError: (params: { userId: string; error: Error }) => void = (params) =>
    console.warn(`[ARIA Memory] Summarization error for ${params.userId}:`, params.error.message)
): MemoryManager {
  return new MemoryManager({
    extractionPrompt:
      'Analyze this conversation between a user and a habit-tracking assistant. Extract goals, struggles, and preferences as a JSON array of {"type", "content"} objects. Return ONLY valid JSON.',
    summarizerProvider,
    historyStore,
    memoryStore: new InMemoryMemoryStore(historyStore),
    onError,
  });
}
