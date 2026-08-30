
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
  /** Count of messages with `createdAt >= since` (inclusive) — do NOT use this for a "strictly after" gate like memory summarization; see AriaMemoryStore.countMessagesSince for that contract instead. */
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

export interface TenantContext {
  tenantId: string;
}

export interface Tool<TArgs = Record<string, unknown>> {
  definition: ToolDefinition;
  handler: (userId: string, args: TArgs, tenant?: TenantContext) => Promise<string>;
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

// ============================================================
// Tenant scoping
// ============================================================

export type SecurityViolationCategory =
  | 'non_whitelisted_field'
  | 'llm_supplied_tenant_id'
  | 'missing_tenant_context';

export interface SecurityViolation {
  category: SecurityViolationCategory;
  detail: string;
  tenantId?: string;
}

export interface SecurityAuditLogConfig {
  store: (violation: SecurityViolation) => Promise<void>;
  onCriticalViolation: (violation: SecurityViolation) => void | Promise<void>;
}

// ============================================================
// Query spec (tenant-scoped analytics)
// ============================================================

export interface QueryWhitelistColumn {
  /** Opaque adapter-defined column reference (e.g. a real Drizzle column). Core never inspects it. */
  ref: unknown;
}

export interface QueryWhitelistTable {
  /** Opaque adapter-defined table reference (e.g. a real Drizzle table object) — the runner's .from()-equivalent needs an actual table, not just its name. Core never inspects it. */
  tableRef: unknown;
  columns: Record<string, QueryWhitelistColumn>;
  /** Whitelist key (must exist in `columns`) identifying this table's tenant-id column. */
  tenantColumnKey: string;
  aggregations: Array<'count' | 'sum' | 'avg'>;
  sortableColumns: string[];
}

export interface QueryWhitelist {
  tables: Record<string, QueryWhitelistTable>;
}

export type QueryFilterOp = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';

export interface QueryFilter {
  column: string;
  op: QueryFilterOp;
  value: string | number | boolean | (string | number)[];
}

export interface QueryDescriptor {
  table: string;
  columns: string[];
  filters?: QueryFilter[];
  aggregation?: { fn: 'count' | 'sum' | 'avg'; column: string };
  sort?: { column: string; direction: 'asc' | 'desc' };
  limit?: number;
}

export interface ResolvedQueryFilter {
  ref: unknown;
  op: QueryFilterOp;
  value: string | number | boolean | (string | number)[];
}

export interface ResolvedQueryPlan {
  /** Human-readable table name, for logging only — NOT for the runner's .from() call, which must use tableRef. */
  table: string;
  /** Opaque table reference resolved from the whitelist — pass this to .from(), never `table`. */
  tableRef: unknown;
  /** Caller-facing whitelist key paired with its resolved opaque ref. The runner needs both to build a real field-selection map (e.g. `db.select({ [key]: ref, ... })`) — a bare ref list would lose the output column names. Core never inspects `ref`. */
  columns: Array<{ key: string; ref: unknown }>;
  filters: ResolvedQueryFilter[];
  /** Always present, always applied by the runner — never optional, never overridable by the descriptor. */
  tenantFilter: { ref: unknown; value: string };
  aggregation?: { fn: 'count' | 'sum' | 'avg'; ref: unknown };
  sort?: { ref: unknown; direction: 'asc' | 'desc' };
  limit: number;
}

export type QueryPlanRunner = (plan: ResolvedQueryPlan) => Promise<Record<string, unknown>[]>;

export interface QuerySpecResult {
  success: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
}
