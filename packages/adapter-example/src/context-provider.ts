import type { AriaContextProvider } from '@aria/core';

export interface ExampleContext {
  userName: string;
  habits: { name: string; streakDays: number }[];
  lastCheckIn: string | null;
}

const FAKE_DB: Record<string, ExampleContext> = {
  demo_user: {
    userName: 'Demo User',
    habits: [
      { name: 'Morning walk', streakDays: 4 },
      { name: 'Journaling', streakDays: 1 },
    ],
    lastCheckIn: '2026-08-12',
  },
};

export class ExampleContextProvider implements AriaContextProvider<ExampleContext> {
  private cache = new Map<string, ExampleContext>();

  async buildContext(userId: string): Promise<ExampleContext> {
    return FAKE_DB[userId] ?? { userName: 'there', habits: [], lastCheckIn: null };
  }

  async getCachedContext(userId: string): Promise<ExampleContext | null> {
    return this.cache.get(userId) ?? null;
  }

  async cacheContext(userId: string, context: ExampleContext): Promise<void> {
    this.cache.set(userId, context);
  }

  async invalidate(userId: string): Promise<void> {
    this.cache.delete(userId);
  }
}
