
// ============================================================
// Context
// ============================================================

export interface AriaContextProvider<TContext> {
  buildContext(userId: string): Promise<TContext>;
  getCachedContext(userId: string): Promise<TContext | null>;
  cacheContext(userId: string, context: TContext, ttlMs?: number): Promise<void>;
  invalidate(userId: string): Promise<void>;
}

// ============================================================
// History
// ============================================================

export interface AriaMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export interface AriaHistoryStore {
  getRecentMessages(userId: string, limit: number): Promise<AriaMessage[]>;
  saveMessage(
    userId: string,
    message: { role: AriaMessage['role']; content: string }
  ): Promise<AriaMessage>;
  clearMessages(userId: string): Promise<void>;
  countMessagesSince(
    userId: string,
    since: Date,
    role?: AriaMessage['role']
  ): Promise<number>;
}

// ============================================================
// Prompt
// ============================================================

export interface AriaPromptConfig<TContext> {
  expertise: string[];
  rules: string[];
  injectContext(context: TContext): string;
  structuredPrompts?: Record<string, (context: TContext) => string>;
}

// ============================================================
// LLM Provider
// ============================================================

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: object;
  /** If true, ChatEngine invalidates the cached context for this user after this tool executes. */
  mutatesContext?: boolean;
}

export interface LLMToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
}

export interface LLMProvider {
  call(params: {
    systemPrompt: string;
    messages: LLMMessage[];
    tools?: ToolDefinition[];
  }): Promise<LLMResponse>;
}

// ============================================================
// Tools
// ============================================================

export interface Tool<TArgs = Record<string, unknown>> {
  definition: ToolDefinition;
  handler: (userId: string, args: TArgs) => Promise<string>;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: string;
  error?: string;
}

// ============================================================
// Rate limiting
// ============================================================

export type SubscriptionTier = 'free' | 'premium';

export interface RateLimitResult {
  allowed: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
}

// ============================================================
// Safety
// ============================================================

export interface SafetyCheckResult {
  blocked: boolean;
  response?: string;
}

// ============================================================
// Guardrails
// ============================================================

export interface GuardrailCheckResult {
  allowed: boolean;
  redirectMessage?: string;
}

// ============================================================
// Fallback
// ============================================================

export interface FallbackTopic {
  match: RegExp;
  response: string;
}

// ============================================================
// Sentiment
// ============================================================

export interface SentimentHint {
  mood: 'positive' | 'neutral' | 'negative' | 'distressed';
  energy: 'high' | 'medium' | 'low';
  intent: 'question' | 'venting' | 'celebration' | 'request' | 'greeting' | 'unknown';
}

// ============================================================
// Memory
// ============================================================

export interface AriaMemoryEntry {
  memoryType: 'conversation_summary' | 'user_preference' | 'goal' | 'concern';
  content: string;
  sourceDate: Date;
}

export interface AriaMemoryStore {
  /** Count of messages strictly after `since` — mirrors the real app's created_at-based gate. */
  countMessagesSince(userId: string, since: Date): Promise<number>;
  /** Timestamp the most recent memory was saved, or null if none exists. Used only for the gate. */
  getLastSummarizedAt(userId: string): Promise<Date | null>;
  /** Up to `limit` memories, ordered by sourceDate descending. Used only for retrieval/display. */
  getMemories(userId: string, limit: number): Promise<AriaMemoryEntry[]>;
  /** ALL memory contents for this user, unlimited — used only for dedup, matching the real app's unlimited dedup query. */
  getAllMemoryContents(userId: string): Promise<string[]>;
  saveMemory(userId: string, entry: AriaMemoryEntry): Promise<void>;
}
