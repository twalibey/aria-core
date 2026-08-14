// packages/core/src/chat-engine.ts
import type {
  AriaContextProvider,
  AriaHistoryStore,
  AriaMessage,
  AriaPromptConfig,
  LLMProvider,
  SubscriptionTier,
  RateLimitResult,
} from './types';
import { buildSystemPrompt } from './personality';
import { checkSafety } from './safety-filter';
import { ToolRegistry } from './tools';
import { FallbackEngine } from './fallback-engine';
import { RateLimiter } from './rate-limiter';

export interface ChatEngineDeps<TContext> {
  contextProvider: AriaContextProvider<TContext>;
  historyStore: AriaHistoryStore;
  promptConfig: AriaPromptConfig<TContext>;
  llmProvider: LLMProvider;
  toolRegistry: ToolRegistry;
  fallbackEngine: FallbackEngine;
  rateLimiter: RateLimiter;
  timezone?: string;
  historyLimit?: number;
}

export interface SendMessageResult {
  userMessage: AriaMessage;
  ariaMessage: AriaMessage;
  rateLimit: RateLimitResult;
}

export class RateLimitExceededError extends Error {
  constructor(public rateLimit: RateLimitResult) {
    super('Daily message limit reached');
    this.name = 'RateLimitExceededError';
  }
}

export class ChatEngine<TContext> {
  private timezone: string;
  private historyLimit: number;

  constructor(private deps: ChatEngineDeps<TContext>) {
    this.timezone = deps.timezone ?? 'UTC';
    this.historyLimit = deps.historyLimit ?? 20;
  }

  async sendMessage(
    userId: string,
    content: string,
    tier: SubscriptionTier
  ): Promise<SendMessageResult> {
    const rateLimit = await this.deps.rateLimiter.check(userId, tier, this.timezone);
    if (!rateLimit.allowed) {
      throw new RateLimitExceededError(rateLimit);
    }

    const safety = checkSafety(content);
    const userMessage = await this.deps.historyStore.saveMessage(userId, {
      role: 'user',
      content,
    });

    if (safety.blocked) {
      const ariaMessage = await this.deps.historyStore.saveMessage(userId, {
        role: 'assistant',
        content: safety.response!,
      });
      return { userMessage, ariaMessage, rateLimit };
    }

    let responseText: string;
    try {
      responseText = await this.generateResponse(userId, content);
    } catch {
      responseText = this.deps.fallbackEngine.respond(content);
    }

    const ariaMessage = await this.deps.historyStore.saveMessage(userId, {
      role: 'assistant',
      content: responseText,
    });

    return { userMessage, ariaMessage, rateLimit };
  }

  private async generateResponse(userId: string, content: string): Promise<string> {
    const history = await this.deps.historyStore.getRecentMessages(userId, this.historyLimit);

    let context = await this.deps.contextProvider.getCachedContext(userId);
    if (!context) {
      context = await this.deps.contextProvider.buildContext(userId);
      await this.deps.contextProvider.cacheContext(userId, context);
    }

    const systemPrompt = buildSystemPrompt(this.deps.promptConfig, context);
    const tools = this.deps.toolRegistry.getDefinitions();

    let response = await this.deps.llmProvider.call({
      systemPrompt,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
      tools: tools.length > 0 ? tools : undefined,
    });

    // Phase 1 simplification: tool results are folded into a synthesized
    // assistant-authored recap rather than using a provider-native tool-result
    // message type (LLMMessage only models user/assistant roles this phase).
    // Sufficient to prove the tool-use interface end-to-end; a native
    // tool-result message type is a Phase 2+ refinement.
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolResults = await Promise.all(
        response.toolCalls.map(async (call) => {
          const result = await this.deps.toolRegistry.execute(userId, call.name, call.arguments);
          return `[${call.name}] ${result.success ? result.result : `Error: ${result.error}`}`;
        })
      );

      response = await this.deps.llmProvider.call({
        systemPrompt,
        messages: [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content },
          { role: 'assistant' as const, content: toolResults.join('\n') },
        ],
      });
    }

    return response.content;
  }
}
