import { randomUUID } from 'node:crypto';
import type { AgentAction, AgentActionStore } from './agent-types.js';

// Reference implementation and test fixture — mirrors InMemoryHistoryStore's
// role: not meant for production use (no persistence across process
// restarts), but a real, exported implementation adapters can use directly
// in their own tests instead of hand-rolling a fake.
export class InMemoryAgentActionStore implements AgentActionStore {
  private actions = new Map<string, AgentAction>();
  private claimIndex = new Set<string>(); // key: `${sourceType}:${sourceId}:${agentId}`

  async claim(params: {
    tenantId: string;
    agentId: string;
    sourceType: string;
    sourceId: string;
  }): Promise<AgentAction | null> {
    const key = `${params.sourceType}:${params.sourceId}:${params.agentId}`;
    if (this.claimIndex.has(key)) return null;
    this.claimIndex.add(key);

    const now = new Date();
    const action: AgentAction = {
      id: randomUUID(),
      tenantId: params.tenantId,
      agentId: params.agentId,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      status: 'processing',
      draftContent: null,
      sourceSnapshot: null,
      attemptCount: 0,
      confirmedByUserId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.actions.set(action.id, action);
    return action;
  }

  async update(
    id: string,
    patch: Partial<
      Pick<AgentAction, 'status' | 'draftContent' | 'sourceSnapshot' | 'attemptCount' | 'confirmedByUserId'>
    >
  ): Promise<AgentAction> {
    const existing = this.actions.get(id);
    if (!existing) throw new Error(`AgentAction not found: ${id}`);
    const updated: AgentAction = { ...existing, ...patch, updatedAt: new Date() };
    this.actions.set(id, updated);
    return updated;
  }

  async get(id: string): Promise<AgentAction | null> {
    return this.actions.get(id) ?? null;
  }
}
