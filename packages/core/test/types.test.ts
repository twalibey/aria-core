import { describe, it, expect } from 'vitest';
import type {
  AriaContextProvider,
  AriaHistoryStore,
  AriaMessage,
  AriaPromptConfig,
  LLMProvider,
  Tool,
  RateLimitResult,
  SafetyCheckResult,
} from '../src/types';

describe('core type shapes', () => {
  it('AriaContextProvider is implementable', async () => {
    const provider: AriaContextProvider<{ name: string }> = {
      async buildContext(userId) {
        return { name: userId };
      },
      async getCachedContext() {
        return null;
      },
      async cacheContext() {},
      async invalidate() {},
    };
    const ctx = await provider.buildContext('u1');
    expect(ctx.name).toBe('u1');
  });

  it('AriaHistoryStore is implementable', async () => {
    const messages: AriaMessage[] = [];
    const store: AriaHistoryStore = {
      async getRecentMessages() {
        return messages;
      },
      async saveMessage(userId, message) {
        const saved: AriaMessage = { id: '1', createdAt: new Date(), ...message };
        messages.push(saved);
        return saved;
      },
      async clearMessages() {
        messages.length = 0;
      },
      async countMessagesSince() {
        return messages.length;
      },
    };
    const saved = await store.saveMessage('u1', { role: 'user', content: 'hi' });
    expect(saved.content).toBe('hi');
    expect(await store.countMessagesSince('u1', new Date(0))).toBe(1);
  });

  it('AriaPromptConfig is implementable', () => {
    const config: AriaPromptConfig<{ name: string }> = {
      expertise: ['testing'],
      rules: ['be nice'],
      injectContext: (ctx) => `Name: ${ctx.name}`,
    };
    expect(config.injectContext({ name: 'Sam' })).toBe('Name: Sam');
  });

  it('LLMProvider is implementable', async () => {
    const provider: LLMProvider = {
      async call() {
        return { content: 'hello' };
      },
    };
    const res = await provider.call({ systemPrompt: 'sys', messages: [] });
    expect(res.content).toBe('hello');
  });

  it('Tool is implementable', async () => {
    const tool: Tool<{ cups: number }> = {
      definition: {
        name: 'log_water',
        description: 'log water',
        parameters: { type: 'object', properties: { cups: { type: 'number' } } },
      },
      handler: async (userId, args) => `Logged ${args.cups} cups for ${userId}`,
    };
    expect(await tool.handler('u1', { cups: 2 })).toBe('Logged 2 cups for u1');
  });

  it('RateLimitResult and SafetyCheckResult shapes hold expected fields', () => {
    const rl: RateLimitResult = { allowed: true, used: 1, limit: 3, remaining: 2 };
    const safety: SafetyCheckResult = { blocked: false };
    expect(rl.allowed).toBe(true);
    expect(safety.blocked).toBe(false);
  });
});
