import type { LLMProvider } from './types.js';
import type { ToolRegistry } from './tools.js';
import type {
  AgentActionStore,
  AgentAction,
  AgentActionStatus,
  AgentDefinition,
  AgentErrorHook,
  AgentRunResult,
} from './agent-types.js';

export class AgentRunner {
  constructor(
    private llmProvider: LLMProvider,
    private toolRegistry: ToolRegistry,
    private actionStore: AgentActionStore,
    private onError?: AgentErrorHook,
    private maxAttempts: number = 3
  ) {}

  async run<Input>(
    definition: AgentDefinition<Input>,
    input: Input,
    tenantId: string,
    sourceId: string
  ): Promise<AgentRunResult> {
    const autonomy = await definition.checkAutonomy(tenantId);
    if (autonomy === 'off') {
      return { status: 'skipped_off' };
    }

    const claimed = await this.actionStore.claim({
      tenantId,
      agentId: definition.id,
      sourceType: definition.sourceType,
      sourceId,
    });
    if (!claimed) {
      return { status: 'skipped_already_claimed' };
    }

    // Defense-in-depth: even if the store ever (re-)returns a terminal
    // needs_attention row, never call the LLM against it — retry cap is 3
    // attempts, not infinite retry.
    if (claimed.status === 'needs_attention') {
      return { status: 'needs_attention', action: claimed };
    }

    let draft;
    try {
      const { systemPrompt, userPrompt } = definition.buildPrompt(input);
      const response = await this.llmProvider.call({
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      draft = definition.parseOutput(response.content);
    } catch (err) {
      return this.handleDraftFailure(definition, tenantId, claimed, err);
    }

    if (autonomy === 'confirm') {
      const updated = await this.actionStore.update(claimed.id, {
        status: 'pending_confirm',
        draftContent: draft.draftContent,
        sourceSnapshot: draft.sourceSnapshot,
      });
      return { status: 'pending_confirm', action: updated };
    }

    // autonomy === 'auto' — implemented in Task 4
    return this.runAutoExecute(definition, tenantId, claimed, draft);
  }

  private async handleDraftFailure<Input>(
    definition: AgentDefinition<Input>,
    tenantId: string,
    claimed: AgentAction,
    err: unknown
  ): Promise<AgentRunResult> {
    const attemptCount = claimed.attemptCount + 1;
    const status: AgentActionStatus = attemptCount >= this.maxAttempts ? 'needs_attention' : 'draft_failed';
    const updated = await this.actionStore.update(claimed.id, { status, attemptCount });
    this.onError?.({
      agentId: definition.id,
      tenantId,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return { status, action: updated };
  }

  private async runAutoExecute<Input>(
    definition: AgentDefinition<Input>,
    tenantId: string,
    claimed: AgentAction,
    draft: { draftContent: string; sourceSnapshot: Record<string, unknown> }
  ): Promise<AgentRunResult> {
    const toolArgs = definition.buildToolArgs(draft);
    const result = await this.toolRegistry.execute(
      `agent:${definition.id}`,
      definition.action.name,
      toolArgs,
      { tenantId }
    );

    if (!result.success) {
      const updated = await this.actionStore.update(claimed.id, {
        status: 'send_failed',
        draftContent: draft.draftContent,
        sourceSnapshot: draft.sourceSnapshot,
      });
      this.onError?.({
        agentId: definition.id,
        tenantId,
        error: new Error(result.error ?? `Tool execution failed for ${definition.action.name}`),
      });
      return { status: 'send_failed', action: updated };
    }

    const updated = await this.actionStore.update(claimed.id, {
      status: 'auto_sent',
      draftContent: draft.draftContent,
      sourceSnapshot: draft.sourceSnapshot,
    });
    return { status: 'auto_sent', action: updated };
  }
}
