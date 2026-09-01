import type { AriaHistoryStore, AriaMemoryEntry, AriaMemoryStore, LLMProvider } from './types.js';
import { stripMarkdownFence } from './fence-parser.js';

export interface MemoryManagerConfig {
  extractionPrompt: string;
  summarizerProvider: LLMProvider;
  historyStore: AriaHistoryStore;
  memoryStore: AriaMemoryStore;
  maxMessagesLoaded?: number;
  minMessagesToTrigger?: number;
  maxMemoriesReturned?: number;
  onError?: (params: { userId: string; error: Error }) => void;
}

const VALID_MEMORY_TYPES: AriaMemoryEntry['memoryType'][] = [
  'conversation_summary',
  'user_preference',
  'goal',
  'concern',
];

export class MemoryManager {
  private extractionPrompt: string;
  private summarizerProvider: LLMProvider;
  private historyStore: AriaHistoryStore;
  private memoryStore: AriaMemoryStore;
  private maxMessagesLoaded: number;
  private minMessagesToTrigger: number;
  private maxMemoriesReturned: number;
  private onError?: (params: { userId: string; error: Error }) => void;
  private inFlight = new Set<string>();

  constructor(config: MemoryManagerConfig) {
    this.extractionPrompt = config.extractionPrompt;
    this.summarizerProvider = config.summarizerProvider;
    this.historyStore = config.historyStore;
    this.memoryStore = config.memoryStore;
    this.maxMessagesLoaded = config.maxMessagesLoaded ?? 30;
    this.minMessagesToTrigger = config.minMessagesToTrigger ?? 10;
    this.maxMemoriesReturned = config.maxMemoriesReturned ?? 20;
    this.onError = config.onError;
  }

  async maybeSummarize(userId: string): Promise<void> {
    if (this.inFlight.has(userId)) return;
    this.inFlight.add(userId);

    try {
      const messages = await this.historyStore.getRecentMessages(userId, this.maxMessagesLoaded);
      if (messages.length < this.minMessagesToTrigger) return;

      const lastSummarizedAt = await this.memoryStore.getLastSummarizedAt(userId);
      if (lastSummarizedAt) {
        const since = await this.memoryStore.countMessagesSince(userId, lastSummarizedAt);
        if (since < this.minMessagesToTrigger) return;
      }

      const conversationText = messages.map((m) => `[${m.role}]: ${m.content}`).join('\n');
      const response = await this.summarizerProvider.call({
        systemPrompt: `${this.extractionPrompt}\n\nRespond with only the JSON — no markdown code fences, no explanation before or after it.`,
        messages: [{ role: 'user', content: conversationText }],
      });

      const extracted = JSON.parse(stripMarkdownFence(response.content)) as {
        type: string;
        content: string;
      }[];
      if (!Array.isArray(extracted) || extracted.length === 0) return;

      const existingContents = new Set(
        (await this.memoryStore.getAllMemoryContents(userId)).map((c) => c.toLowerCase())
      );

      // Matches a mutation quirk in the real source: the loaded batch is
      // reversed in place earlier in the real function, so index 0 ends up
      // the OLDEST message in the batch by the time it's read for sourceDate.
      const sourceDate = messages[0].createdAt;

      for (const item of extracted) {
        if (existingContents.has(item.content.toLowerCase())) continue;
        const memoryType = VALID_MEMORY_TYPES.includes(item.type as AriaMemoryEntry['memoryType'])
          ? (item.type as AriaMemoryEntry['memoryType'])
          : 'conversation_summary';
        await this.memoryStore.saveMemory(userId, { memoryType, content: item.content, sourceDate });
      }
    } catch (err) {
      this.onError?.({ userId, error: err instanceof Error ? err : new Error(String(err)) });
    } finally {
      this.inFlight.delete(userId);
    }
  }

  async buildMemoryPromptSection(userId: string): Promise<string> {
    const memories = await this.memoryStore.getMemories(userId, this.maxMemoriesReturned);
    if (memories.length === 0) return '';

    const lines = memories.map(
      (m) => `- [${m.memoryType}] ${m.content} (from ${m.sourceDate.toLocaleDateString()})`
    );

    return [
      '\n## WHAT YOU REMEMBER FROM PAST CONVERSATIONS',
      lines.join('\n'),
      '',
      "Use these memories naturally — reference them when relevant, but don't force them into every response.",
      "If a memory seems outdated, ask the user if it's still accurate.",
    ].join('\n');
  }
}
