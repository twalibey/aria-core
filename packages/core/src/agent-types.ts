import type { ToolDefinition } from './types.js';

export type AutonomyLevel = 'off' | 'confirm' | 'auto';

export type AgentActionStatus =
  | 'processing'
  | 'pending_confirm'
  | 'auto_sent'
  | 'draft_failed'
  | 'needs_attention'
  | 'sent'
  | 'edited_and_sent'
  | 'rejected'
  | 'send_failed';

export interface AgentAction {
  id: string;
  tenantId: string;
  agentId: string;
  sourceType: string;
  sourceId: string;
  status: AgentActionStatus;
  draftContent: string | null;
  sourceSnapshot: Record<string, unknown> | null;
  attemptCount: number;
  confirmedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentDraftOutput {
  draftContent: string;
  sourceSnapshot: Record<string, unknown>;
}

export interface AgentActionStore {
  claim(params: {
    tenantId: string;
    agentId: string;
    sourceType: string;
    sourceId: string;
  }): Promise<AgentAction | null>;
  update(
    id: string,
    patch: Partial<
      Pick<AgentAction, 'status' | 'draftContent' | 'sourceSnapshot' | 'attemptCount' | 'confirmedByUserId'>
    >
  ): Promise<AgentAction>;
  get(id: string): Promise<AgentAction | null>;
}

export interface AgentDefinition<Input> {
  id: string;
  sourceType: string;
  buildPrompt(input: Input): { systemPrompt: string; userPrompt: string };
  parseOutput(raw: string): AgentDraftOutput;
  /**
   * Optional hook run immediately after parseOutput, before sourceSnapshot
   * is used or persisted anywhere. Lets an agent overwrite/inject fields in
   * the model-produced sourceSnapshot with real, non-LLM-derived data (the
   * model should never be trusted as the source of truth for operational
   * fields like a recipient address). Receives the original run() input
   * and the freshly-parsed draft; returns the sourceSnapshot to actually use.
   */
  enrichSnapshot?(input: Input, draft: AgentDraftOutput): Record<string, unknown>;
  action: ToolDefinition;
  buildToolArgs(draft: AgentDraftOutput): Record<string, unknown>;
  checkAutonomy(tenantId: string): Promise<AutonomyLevel>;
}

export type AgentErrorHook = (params: { agentId: string; tenantId: string; error: Error }) => void;

export interface AgentRunResult {
  status: AgentActionStatus | 'skipped_off' | 'skipped_already_claimed';
  action?: AgentAction;
}
