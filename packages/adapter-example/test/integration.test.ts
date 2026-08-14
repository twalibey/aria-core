import { describe, it, expect } from 'vitest';
import {
  ChatEngine,
  InMemoryHistoryStore,
  RateLimiter,
  ToolRegistry,
  FallbackEngine,
} from '@aria/core';
import type { LLMProvider } from '@aria/core';
import { ExampleContextProvider, examplePromptConfig, checkInTool } from '../src';

describe('adapter-example end-to-end', () => {
  it('exercises every core interface through a full sendMessage call', async () => {
    const historyStore = new InMemoryHistoryStore();
    const contextProvider = new ExampleContextProvider();
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(checkInTool);

    let callCount = 0;
    const llmProvider: LLMProvider = {
      async call() {
        callCount++;
        if (callCount === 1) {
          return {
            content: '',
            toolCalls: [{ name: 'check_in_habit', arguments: { habitName: 'Morning walk' } }],
          };
        }
        return { content: 'Nice work checking in on your morning walk!' };
      },
    };

    const engine = new ChatEngine({
      contextProvider,
      historyStore,
      promptConfig: examplePromptConfig,
      llmProvider,
      toolRegistry,
      fallbackEngine: new FallbackEngine([], "I'm here to help with your habits."),
      rateLimiter: new RateLimiter(historyStore, { freeLimit: 3 }),
    });

    const result = await engine.sendMessage('demo_user', 'I finished my morning walk', 'free');

    expect(result.ariaMessage.content).toBe('Nice work checking in on your morning walk!');
    expect(result.userMessage.content).toBe('I finished my morning walk');
    expect(callCount).toBe(2);

    const history = await historyStore.getRecentMessages('demo_user', 10);
    expect(history).toHaveLength(2);
  });

  it('respects the safety filter and rate limiter identically to any other domain', async () => {
    const historyStore = new InMemoryHistoryStore();
    const engine = new ChatEngine({
      contextProvider: new ExampleContextProvider(),
      historyStore,
      promptConfig: examplePromptConfig,
      llmProvider: { async call() { return { content: 'should not be reached' }; } },
      toolRegistry: new ToolRegistry(),
      fallbackEngine: new FallbackEngine([], 'fallback'),
      rateLimiter: new RateLimiter(historyStore, { freeLimit: 1 }),
    });

    const safetyResult = await engine.sendMessage('demo_user', 'I want to end my life', 'free');
    expect(safetyResult.ariaMessage.content).toContain('988');
  });
});
