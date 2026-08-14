// packages/core/src/chat-engine.ts
import type {
  AriaContextProvider,
  AriaHistoryStore,
  AriaMessage,
  AriaPromptConfig,
  LLMProvider,
  SubscriptionTier,
  RateLimitResult,
} from './types.js';
import { buildSystemPrompt } from './personality.js';
import { checkSafety } from './safety-filter.js';
import { ToolRegistry } from './tools.js';
import { FallbackEngine } from './fallback-engine.js';
import { RateLimiter } from './rate-limiter.js';

/**
 * Where in `generateResponse` a failure happened. `context` covers history
 * retrieval and context building/caching, `llm` covers both LLM calls (and
 * system-prompt assembly), `tool` covers tool execution.
 */
export type ChatEngineErrorStage = 'context' | 'llm' | 'tool';

export type ChatEngineErrorHook = (params: {
  userId: string;
  stage: ChatEngineErrorStage;
  error: Error;
}) => void;

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
  /**
   * Optional error-visibility hook. Without it, every failure inside
   * `generateResponse` is rendered identically as the fallback-engine response
   * with no telemetry. Consumers should wire this to their logger/monitoring.
   */
  onError?: ChatEngineErrorHook;
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
      responseText = await this.generateResponse(userId);
    } catch {
      responseText = this.deps.fallbackEngine.respond(content);
    }

    const ariaMessage = await this.deps.historyStore.saveMessage(userId, {
      role: 'assistant',
      content: responseText,
    });

    return { userMessage, ariaMessage, rateLimit };
  }

  private reportError(userId: string, stage: ChatEngineErrorStage, err: unknown): void {
    this.deps.onError?.({
      userId,
      stage,
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }

  private async generateResponse(userId: string): Promise<string> {
    // `history` already ends with the current user turn: sendMessage() persists
    // the user message before calling this method. Nothing here may append a
    // second copy of it.
    let history: AriaMessage[];
    let context: TContext;
    try {
      history = await this.deps.historyStore.getRecentMessages(userId, this.historyLimit);

      const cached = await this.deps.contextProvider.getCachedContext(userId);
      if (cached) {
        context = cached;
      } else {
        context = await this.deps.contextProvider.buildContext(userId);
        await this.deps.contextProvider.cacheContext(userId, context);
      }
    } catch (err) {
      this.reportError(userId, 'context', err);
      throw err;
    }

    const priorMessages = history.map((m) => ({ role: m.role, content: m.content }));

    let systemPrompt: string;
    let response;
    try {
      systemPrompt = buildSystemPrompt(this.deps.promptConfig, context);
      const tools = this.deps.toolRegistry.getDefinitions();

      response = await this.deps.llmProvider.call({
        systemPrompt,
        messages: priorMessages,
        tools: tools.length > 0 ? tools : undefined,
      });
    } catch (err) {
      this.reportError(userId, 'llm', err);
      throw err;
    }

    // Phase 1 simplification: tool results are folded back in as an ordinary
    // user-role turn rather than a provider-native tool-result message type
    // (LLMMessage only models user/assistant roles this phase). The follow-up
    // turn MUST be user-role: an assistant-role final turn is a "prefill" on
    // the Anthropic Messages API and is rejected with HTTP 400.
    if (response.toolCalls && response.toolCalls.length > 0) {
      let toolResults: string[];
      try {
        toolResults = await Promise.all(
          response.toolCalls.map(async (call) => {
            const result = await this.deps.toolRegistry.execute(userId, call.name, call.arguments);
            return `[${call.name}] ${result.success ? result.result : `Error: ${result.error}`}`;
          })
        );
      } catch (err) {
        this.reportError(userId, 'tool', err);
        throw err;
      }

      try {
        response = await this.deps.llmProvider.call({
          systemPrompt,
          messages: [
            ...priorMessages,
            { role: 'user' as const, content: `Tool results:\n${toolResults.join('\n')}` },
          ],
        });
      } catch (err) {
        this.reportError(userId, 'llm', err);
        throw err;
      }
    }

    return response.content;
  }
}
