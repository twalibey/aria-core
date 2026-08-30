import { describe, it, expect, vi } from 'vitest';
import {
  ChatEngine,
  InMemoryHistoryStore,
  RateLimiter,
  ToolRegistry,
  FallbackEngine,
  SecurityAuditLog,
} from '@aria/core';
import type { LLMProvider } from '@aria/core';
import { ExampleContextProvider, examplePromptConfig } from '../src';

describe('adapter-example: tenant-scoping mechanism end-to-end', () => {
  it('routes a real TenantContext through sendMessage -> ToolRegistry -> tool handler, and blocks an LLM-supplied tenantId', async () => {
    const store = vi.fn().mockResolvedValue(undefined);
    const onCriticalViolation = vi.fn();
    const securityAuditLog = new SecurityAuditLog({ store, onCriticalViolation });

    const toolRegistry = new ToolRegistry(undefined, securityAuditLog);
    toolRegistry.register({
      definition: {
        name: 'get_habit_streak',
        description: 'Gets the current streak for a habit',
        parameters: {
          type: 'object',
          properties: { habitName: { type: 'string' } },
          required: ['habitName'],
          additionalProperties: false,
        },
      },
      handler: async (_userId, args, tenant) =>
        `${(args as { habitName: string }).habitName} streak for tenant ${tenant?.tenantId}: 5 days`,
    });

    const historyStore = new InMemoryHistoryStore();
    let callCount = 0;
    const llmProvider: LLMProvider = {
      async call() {
        callCount++;
        if (callCount === 1) {
          // First LLM call attempts to smuggle its own tenantId — must be
          // stripped and logged, never trusted.
          return {
            content: '',
            toolCalls: [
              { name: 'get_habit_streak', arguments: { habitName: 'Morning walk', tenantId: 'attacker-tenant' } },
            ],
          };
        }
        return { content: 'Your morning walk streak is 5 days!' };
      },
    };

    const engine = new ChatEngine({
      contextProvider: new ExampleContextProvider(),
      historyStore,
      promptConfig: examplePromptConfig,
      llmProvider,
      toolRegistry,
      fallbackEngine: new FallbackEngine([], 'fallback'),
      rateLimiter: new RateLimiter(historyStore, { freeLimit: 10 }),
    });

    const result = await engine.sendMessage('demo_user', 'how is my streak?', 'free', {
      tenantId: 'real-tenant',
    });

    expect(result.ariaMessage.content).toBe('Your morning walk streak is 5 days!');
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'llm_supplied_tenant_id', tenantId: 'real-tenant' })
    );
  });
});
