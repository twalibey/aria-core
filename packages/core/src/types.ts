
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
