// packages/core/test/chat-engine.test.ts
import { describe, it, expect } from 'vitest';
import { ChatEngine, RateLimitExceededError } from '../src/chat-engine';
import { InMemoryHistoryStore } from '../src/history/in-memory-store';
import { RateLimiter } from '../src/rate-limiter';
import { ToolRegistry } from '../src/tools';
import { FallbackEngine } from '../src/fallback-engine';
import type {
  AriaContextProvider,
  AriaPromptConfig,
  LLMProvider,
  LLMResponse,
} from '../src/types';

interface TestContext {
  name: string;
}

function makeContextProvider(context: TestContext): AriaContextProvider<TestContext> {
  let cached: TestContext | null = null;
  return {
    async buildContext() {
      return context;
    },
    async getCachedContext() {
      return cached;
    },
    async cacheContext(_userId, ctx) {
      cached = ctx;
    },
    async invalidate() {
      cached = null;
    },
  };
}

const promptConfig: AriaPromptConfig<TestContext> = {
  expertise: ['testing'],
  rules: ['be nice'],
  injectContext: (ctx) => `User: ${ctx.name}`,
};

function makeStubProvider(responses: LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    async call() {
      return responses[Math.min(i++, responses.length - 1)];
    },
  };
}

function buildEngine(
  overrides: { llmProvider?: LLMProvider; freeLimit?: number } = {}
) {
  const historyStore = new InMemoryHistoryStore();
  const rateLimiter = new RateLimiter(historyStore, { freeLimit: overrides.freeLimit ?? 3 });
  const toolRegistry = new ToolRegistry();
  const fallbackEngine = new FallbackEngine([], 'Fallback response');
  const engine = new ChatEngine({
    contextProvider: makeContextProvider({ name: 'Sam' }),
    historyStore,
    promptConfig,
    llmProvider: overrides.llmProvider ?? makeStubProvider([{ content: 'Hi Sam!' }]),
    toolRegistry,
    fallbackEngine,
    rateLimiter,
  });
  return { engine, historyStore, toolRegistry };
}

describe('ChatEngine.sendMessage', () => {
  it('saves the user message and the LLM response, returning both', async () => {
    const { engine } = buildEngine();
    const result = await engine.sendMessage('u1', 'Hello ARIA', 'free');

    expect(result.userMessage.content).toBe('Hello ARIA');
    expect(result.ariaMessage.content).toBe('Hi Sam!');
    expect(result.rateLimit.allowed).toBe(true);
  });

  it('throws RateLimitExceededError once the free daily limit is hit', async () => {
    const { engine } = buildEngine({ freeLimit: 1 });
    await engine.sendMessage('u1', 'first', 'free');

    await expect(engine.sendMessage('u1', 'second', 'free')).rejects.toBeInstanceOf(
      RateLimitExceededError
    );
  });

  it('blocks on crisis language without calling the LLM provider', async () => {
    let called = false;
    const llmProvider: LLMProvider = {
      async call() {
        called = true;
        return { content: 'should not reach here' };
      },
    };
    const { engine } = buildEngine({ llmProvider });

    const result = await engine.sendMessage('u1', 'I want to end my life', 'free');

    expect(called).toBe(false);
    expect(result.ariaMessage.content).toContain('988');
  });

  it('falls back to the fallback engine when the LLM provider throws', async () => {
    const llmProvider: LLMProvider = {
      async call() {
        throw new Error('provider down');
      },
    };
    const { engine } = buildEngine({ llmProvider });

    const result = await engine.sendMessage('u1', 'Hello', 'free');

    expect(result.ariaMessage.content).toBe('Fallback response');
  });

  it('executes a tool call and folds the result into a follow-up LLM call', async () => {
    const { engine, toolRegistry } = buildEngine({
      llmProvider: makeStubProvider([
        { content: '', toolCalls: [{ name: 'log_water', arguments: { cups: 2 } }] },
        { content: 'Logged your water, nice work!' },
      ]),
    });

    toolRegistry.register({
      definition: {
        name: 'log_water',
        description: 'Log water intake',
        parameters: {
          type: 'object',
          properties: { cups: { type: 'number' } },
          required: ['cups'],
        },
      },
      handler: async (userId, args: { cups: number }) =>
        `Logged ${args.cups} cups for ${userId}`,
    });

    const result = await engine.sendMessage('u1', 'I drank 2 cups of water', 'free');

    expect(result.ariaMessage.content).toBe('Logged your water, nice work!');
  });
});
