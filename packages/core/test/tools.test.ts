import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../src/tools';
import type { Tool } from '../src/types';
import { SecurityAuditLog } from '../src/security-audit-log';

const logWaterTool: Tool<{ cups: number }> = {
  definition: {
    name: 'log_water',
    description: 'Log water intake',
    parameters: {
      type: 'object',
      properties: { cups: { type: 'number' } },
      required: ['cups'],
      additionalProperties: false,
    },
  },
  handler: async (userId, args) => `Logged ${args.cups} cups for ${userId}`,
};

const throwingTool: Tool = {
  definition: {
    name: 'always_throws',
    description: 'always throws',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  handler: async () => {
    throw new Error('boom');
  },
};

describe('ToolRegistry', () => {
  it('executes a registered tool with valid arguments', async () => {
    const registry = new ToolRegistry();
    registry.register(logWaterTool);
    const result = await registry.execute('u1', 'log_water', { cups: 2 });
    expect(result).toEqual({ success: true, result: 'Logged 2 cups for u1' });
  });

  it('rejects arguments that do not match the schema', async () => {
    const registry = new ToolRegistry();
    registry.register(logWaterTool);
    const result = await registry.execute('u1', 'log_water', { cups: 'two' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('log_water');
  });

  it('returns a structured error for an unregistered tool name', async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute('u1', 'does_not_exist', {});
    expect(result).toEqual({ success: false, error: 'Unknown tool: does_not_exist' });
  });

  it('catches a thrown handler error and returns it as a structured result', async () => {
    const registry = new ToolRegistry();
    registry.register(throwingTool);
    const result = await registry.execute('u1', 'always_throws', {});
    expect(result).toEqual({ success: false, error: 'boom' });
  });

  it('invokes the onToolError hook for every failure path', async () => {
    const onToolError = vi.fn();
    const registry = new ToolRegistry(onToolError);
    registry.register(logWaterTool);
    registry.register(throwingTool);

    await registry.execute('u1', 'does_not_exist', {});
    await registry.execute('u1', 'log_water', { cups: 'two' });
    await registry.execute('u1', 'always_throws', {});

    expect(onToolError).toHaveBeenCalledTimes(3);
  });

  it('exposes tool definitions for passing to the LLM provider', () => {
    const registry = new ToolRegistry();
    registry.register(logWaterTool);
    expect(registry.getDefinitions()).toEqual([logWaterTool.definition]);
  });
});

describe('ToolRegistry tenant-scoped mode', () => {
  const tenantTool: Tool<{ id: string }> = {
    definition: {
      name: 'get_record',
      description: 'Get a record by id',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
    handler: async (userId, args, tenant) => `record ${args.id} for tenant ${tenant?.tenantId}`,
  };

  function makeAuditLog() {
    const store = vi.fn().mockResolvedValue(undefined);
    const onCriticalViolation = vi.fn();
    return { log: new SecurityAuditLog({ store, onCriticalViolation }), store, onCriticalViolation };
  }

  it('passes tenant context through to the handler', async () => {
    const { log } = makeAuditLog();
    const registry = new ToolRegistry(undefined, log);
    registry.register(tenantTool);
    const result = await registry.execute('u1', 'get_record', { id: 'r1' }, { tenantId: 't1' });
    expect(result).toEqual({ success: true, result: 'record r1 for tenant t1' });
  });

  it('fails closed and logs a violation when tenant-scoped mode is on but no tenant is provided', async () => {
    const { log, store } = makeAuditLog();
    const registry = new ToolRegistry(undefined, log);
    registry.register(tenantTool);
    const result = await registry.execute('u1', 'get_record', { id: 'r1' });
    expect(result.success).toBe(false);
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'missing_tenant_context' })
    );
  });

  it('strips an LLM-supplied tenantId argument and logs a violation instead of trusting it', async () => {
    const { log, store } = makeAuditLog();
    const registry = new ToolRegistry(undefined, log);
    registry.register(tenantTool);
    const result = await registry.execute(
      'u1',
      'get_record',
      { id: 'r1', tenantId: 'attacker-supplied-tenant' },
      { tenantId: 't1' }
    );
    expect(result).toEqual({ success: true, result: 'record r1 for tenant t1' });
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'llm_supplied_tenant_id', tenantId: 't1' })
    );
  });

  it('strips an LLM-supplied snake_case tenant_id argument and logs a violation instead of trusting it', async () => {
    const { log, store } = makeAuditLog();
    const registry = new ToolRegistry(undefined, log);
    registry.register(tenantTool);
    const result = await registry.execute(
      'u1',
      'get_record',
      { id: 'r1', tenant_id: 'attacker-supplied-tenant' },
      { tenantId: 't1' }
    );
    expect(result).toEqual({ success: true, result: 'record r1 for tenant t1' });
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'llm_supplied_tenant_id', tenantId: 't1' })
    );
  });

  it('strips both tenantId and tenant_id when an LLM supplies both spellings at once', async () => {
    const { log, store } = makeAuditLog();
    const registry = new ToolRegistry(undefined, log);
    registry.register(tenantTool);
    const result = await registry.execute(
      'u1',
      'get_record',
      { id: 'r1', tenantId: 'attacker-1', tenant_id: 'attacker-2' },
      { tenantId: 't1' }
    );
    expect(result).toEqual({ success: true, result: 'record r1 for tenant t1' });
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'llm_supplied_tenant_id', tenantId: 't1' })
    );
  });

  it('does not require tenant context when tenant-scoped mode is off (no SecurityAuditLog)', async () => {
    const registry = new ToolRegistry();
    registry.register(tenantTool);
    const result = await registry.execute('u1', 'get_record', { id: 'r1' });
    expect(result).toEqual({ success: true, result: 'record r1 for tenant undefined' });
  });

  it('never throws when the security audit log store rejects, and returns a structured failure instead', async () => {
    const onToolError = vi.fn();
    const store = vi.fn().mockRejectedValue(new Error('audit log DB write failed'));
    const onCriticalViolation = vi.fn();
    const log = new SecurityAuditLog({ store, onCriticalViolation });
    const registry = new ToolRegistry(onToolError, log);
    registry.register(tenantTool);

    const result = await registry.execute(
      'u1',
      'get_record',
      { id: 'r1', tenantId: 'attacker-supplied-tenant' },
      { tenantId: 't1' }
    );

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(onToolError).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'get_record', userId: 'u1' })
    );
  });

  it('never throws when the security audit log store rejects on the missing-tenant-context path', async () => {
    const store = vi.fn().mockRejectedValue(new Error('audit log DB write failed'));
    const onCriticalViolation = vi.fn();
    const log = new SecurityAuditLog({ store, onCriticalViolation });
    const registry = new ToolRegistry(undefined, log);
    registry.register(tenantTool);

    const result = await registry.execute('u1', 'get_record', { id: 'r1' });

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });
});
