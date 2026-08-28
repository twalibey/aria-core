import { describe, it, expect } from 'vitest';
import {
  ChatEngine,
  InMemoryHistoryStore,
  RateLimiter,
  ToolRegistry,
  FallbackEngine,
} from '@aria/core';
import type { LLMProvider } from '@aria/core';
import { ExampleContextProvider, examplePromptConfig } from '../src';
import { exampleGuardrails } from '../src/guardrails-config';
import { exampleSentiment } from '../src/sentiment-config';
import { createExampleMemory } from '../src/memory-config';

describe('adapter-example — guardrails/sentiment/memory', () => {
  it('redirects an off-topic message using exampleGuardrails', async () => {
    const historyStore = new InMemoryHistoryStore();
    let called = false;
    const llmProvider: LLMProvider = {
      async call() {
        called = true;
        return { content: 'should not reach here' };
      },
    };
    const engine = new ChatEngine({
      contextProvider: new ExampleContextProvider(),
      historyStore,
      promptConfig: examplePromptConfig,
      llmProvider,
      toolRegistry: new ToolRegistry(),
      fallbackEngine: new FallbackEngine([], 'fallback'),
      rateLimiter: new RateLimiter(historyStore, { freeLimit: 3 }),
      guardrails: exampleGuardrails,
    });

    const result = await engine.sendMessage('demo_user', 'what is the weather forecast today', 'free');

    expect(called).toBe(false);
    expect(result.ariaMessage.content).toContain('habits');
  });

  it('appends a sentiment section using exampleSentiment', async () => {
    const historyStore = new InMemoryHistoryStore();
    const calls: { systemPrompt: string }[] = [];
    const llmProvider: LLMProvider = {
      async call(params) {
        calls.push(params);
        return { content: 'nice work' };
      },
    };
    const engine = new ChatEngine({
      contextProvider: new ExampleContextProvider(),
      historyStore,
      promptConfig: examplePromptConfig,
      llmProvider,
      toolRegistry: new ToolRegistry(),
      fallbackEngine: new FallbackEngine([], 'fallback'),
      rateLimiter: new RateLimiter(historyStore, { freeLimit: 3 }),
      sentiment: exampleSentiment,
    });

    await engine.sendMessage('demo_user', 'I nailed it today, streak intact', 'free');

    expect(calls[0].systemPrompt).toContain('CURRENT MESSAGE CONTEXT');
  });

  it('summarizes and later recalls a memory using createExampleMemory', async () => {
    const historyStore = new InMemoryHistoryStore();
    for (let i = 0; i < 10; i++) {
      await historyStore.saveMessage('demo_user', { role: 'user', content: `check-in ${i}` });
    }
    const summarizerProvider: LLMProvider = {
      async call() {
        return { content: JSON.stringify([{ type: 'goal', content: 'Build a daily walking habit' }]) };
      },
    };
    const memory = createExampleMemory(historyStore, summarizerProvider);

    await memory.maybeSummarize('demo_user');
    const section = await memory.buildMemoryPromptSection('demo_user');

    expect(section).toContain('Build a daily walking habit');
  });
});
