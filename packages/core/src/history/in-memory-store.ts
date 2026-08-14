import type { AriaHistoryStore, AriaMessage } from '../types';

let idCounter = 0;

export class InMemoryHistoryStore implements AriaHistoryStore {
  private messages = new Map<string, AriaMessage[]>();

  async getRecentMessages(userId: string, limit: number): Promise<AriaMessage[]> {
    const all = this.messages.get(userId) ?? [];
    return all.slice(-limit);
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
