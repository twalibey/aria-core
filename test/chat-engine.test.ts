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
  LLMMessage,
  LLMProvider,
  LLMResponse,
} from '../src/types';
import type { ChatEngineDeps } from '../src/chat-engine';

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
  overrides: {
    llmProvider?: LLMProvider;
    freeLimit?: number;
    onError?: ChatEngineDeps<TestContext>['onError'];
  } = {}
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
    onError: overrides.onError,
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

  it('builds a valid follow-up message array for the second LLM call in a tool-call turn', async () => {
    // Regression test: the follow-up call must NOT end on an assistant-role
    // turn (an Anthropic Messages API "prefill", rejected with HTTP 400), and
    // must not duplicate the current user turn.
    const calls: LLMMessage[][] = [];
    const responses: LLMResponse[] = [
      { content: '', toolCalls: [{ name: 'log_water', arguments: { cups: 2 } }] },
      { content: 'Logged your water, nice work!' },
    ];
    let i = 0;
    const llmProvider: LLMProvider = {
      async call(params) {
        calls.push(params.messages);
        return responses[Math.min(i++, responses.length - 1)];
      },
    };

    const { engine, toolRegistry } = buildEngine({ llmProvider });
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

    const userContent = 'I drank 2 cups of water';
    await engine.sendMessage('u1', userContent, 'free');

    expect(calls).toHaveLength(2);
    const followUp = calls[1];

    // (a) The array must not end on an assistant-role turn.
    expect(followUp[followUp.length - 1].role).not.toBe('assistant');
    expect(followUp[followUp.length - 1].role).toBe('user');

    // (b) The user's original message appears exactly once across the array.
    const occurrences = followUp.filter((m) => m.content === userContent).length;
    expect(occurrences).toBe(1);

    // And the tool results actually reached the follow-up call.
    expect(followUp[followUp.length - 1].content).toContain('Logged 2 cups for u1');
  });

  it('invokes onError with stage "llm" when the LLM provider throws', async () => {
    const seen: { userId: string; stage: string; error: Error }[] = [];
    const llmProvider: LLMProvider = {
      async call() {
        throw new Error('provider down');
      },
    };
    const { engine } = buildEngine({
      llmProvider,
      onError: (params) => seen.push(params),
    });

    const result = await engine.sendMessage('u1', 'Hello', 'free');

    expect(result.ariaMessage.content).toBe('Fallback response');
    expect(seen).toHaveLength(1);
    expect(seen[0].stage).toBe('llm');
    expect(seen[0].userId).toBe('u1');
    expect(seen[0].error).toBeInstanceOf(Error);
    expect(seen[0].error.message).toBe('provider down');
  });

  it('invokes onError with stage "context" when the context provider throws', async () => {
    const seen: { stage: string }[] = [];
    const historyStore = new InMemoryHistoryStore();
    const engine = new ChatEngine<TestContext>({
      contextProvider: {
        async buildContext() {
          throw new Error('context blew up');
        },
        async getCachedContext() {
          return null;
        },
        async cacheContext() {},
        async invalidate() {},
      },
      historyStore,
      promptConfig,
      llmProvider: makeStubProvider([{ content: 'never reached' }]),
      toolRegistry: new ToolRegistry(),
      fallbackEngine: new FallbackEngine([], 'Fallback response'),
      rateLimiter: new RateLimiter(historyStore, { freeLimit: 3 }),
      onError: (params) => seen.push(params),
    });

    const result = await engine.sendMessage('u1', 'Hello', 'free');

    expect(result.ariaMessage.content).toBe('Fallback response');
    expect(seen.map((s) => s.stage)).toEqual(['context']);
  });
});
