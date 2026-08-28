import { MemoryManager } from '@aria/core';
import type { AriaHistoryStore, AriaMemoryStore, AriaMemoryEntry, LLMProvider } from '@aria/core';

const EXTRACTION_PROMPT = `Analyze this conversation between a user and ARIA (a wellness AI assistant).
Extract ONLY information that would be useful in future conversations:
- Goals the user mentioned (training for an event, weight target, etc.)
- Concerns or struggles they shared (knee pain, poor sleep, stress at work)
- Preferences they expressed (likes yoga, hates running, prefers morning workouts)
- Important life context (new job, injury recovery, pregnant, etc.)

Return a JSON array of memories:
[
  { "type": "goal", "content": "Training for a half marathon in October 2024" },
  { "type": "concern", "content": "Right knee pain that flares up during running" },
  { "type": "user_preference", "content": "Prefers bodyweight exercises at home, no gym access" }
]

Only include genuinely useful, specific information. Skip greetings, generic questions, and routine check-ins.
If there is nothing meaningful to extract, return an empty array: []
Return ONLY valid JSON, no markdown.`;

class InMemoryFitnessMemoryStore implements AriaMemoryStore {
  private memories = new Map<string, AriaMemoryEntry[]>();
  private lastSummarizedAt = new Map<string, Date>();

  constructor(private historyStore: AriaHistoryStore) {}

  async countMessagesSince(userId: string, since: Date): Promise<number> {
    // Count messages STRICTLY after `since`, not including messages at the same instant
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

export function createFitnessMemory(
  historyStore: AriaHistoryStore,
  summarizerProvider: LLMProvider,
  onError: (params: { userId: string; error: Error }) => void = (params) =>
    console.warn(`[ARIA Memory] Summarization error for ${params.userId}:`, params.error.message)
): MemoryManager {
  return new MemoryManager({
    extractionPrompt: EXTRACTION_PROMPT,
    summarizerProvider,
    historyStore,
    memoryStore: new InMemoryFitnessMemoryStore(historyStore),
    onError,
  });
}
