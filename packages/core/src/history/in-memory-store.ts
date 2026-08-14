import type { AriaHistoryStore, AriaMessage } from '../types.js';

let idCounter = 0;

export class InMemoryHistoryStore implements AriaHistoryStore {
  private messages = new Map<string, AriaMessage[]>();

  async getRecentMessages(userId: string, limit: number): Promise<AriaMessage[]> {
    const all = this.messages.get(userId) ?? [];
    // Guard against limit <= 0: `slice(-0)` is `slice(0)`, which would return
    // the ENTIRE history when the caller asked for none.
    return limit <= 0 ? [] : all.slice(-limit);
  }

  async saveMessage(
    userId: string,
    message: { role: AriaMessage['role']; content: string }
  ): Promise<AriaMessage> {
    const saved: AriaMessage = {
      id: `msg_${++idCounter}`,
      createdAt: new Date(),
      ...message,
    };
    const existing = this.messages.get(userId) ?? [];
    existing.push(saved);
    this.messages.set(userId, existing);
    return saved;
  }

  async clearMessages(userId: string): Promise<void> {
    this.messages.delete(userId);
  }

  async countMessagesSince(
    userId: string,
    since: Date,
    role?: AriaMessage['role']
  ): Promise<number> {
    const all = this.messages.get(userId) ?? [];
    return all.filter((m) => m.createdAt >= since && (role === undefined || m.role === role))
      .length;
  }
}
