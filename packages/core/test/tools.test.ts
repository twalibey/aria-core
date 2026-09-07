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

// Shared fixture for tests that don't care about audit-log call assertions —
// securityAuditLog is now a mandatory constructor argument regardless of
// whether a given ToolRegistry is tenant-scoped.
function makeAuditLog() {
  const store = vi.fn().mockResolvedValue(undefined);
  const onCriticalViolation = vi.fn();
  return { log: new SecurityAuditLog({ store, onCriticalViolation }), store, onCriticalViolation };
}

describe('ToolRegistry', () => {
  it('executes a registered tool with valid arguments', async () => {
    const { log } = makeAuditLog();
    const registry = new ToolRegistry(undefined, log, false);
    registry.register(logWaterTool);
    const result = await registry.execute('u1', 'log_water', { cups: 2 });
    expect(result).toEqual({ success: true, result: 'Logged 2 cups for u1' });
  });

  it('rejects arguments that do not match the schema', async () => {
    const { log } = makeAuditLog();
    const registry = new ToolRegistry(undefined, log, false);
    registry.register(logWaterTool);
    const result = await registry.execute('u1', 'log_water', { cups: 'two' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('log_water');
  });

  it('returns a structured error for an unregistered tool name', async () => {
    const { log } = makeAuditLog();
    const registry = new ToolRegistry(undefined, log, false);
    const result = await registry.execute('u1', 'does_not_exist', {});
    expect(result).toEqual({ success: false, error: 'Unknown tool: does_not_exist' });
  });

  it('catches a thrown handler error and returns it as a structured result', async () => {
    const { log } = makeAuditLog();
    const registry = new ToolRegistry(undefined, log, false);
    registry.register(throwingTool);
    const result = await registry.execute('u1', 'always_throws', {});
    expect(result).toEqual({ success: false, error: 'boom' });
  });

  it('invokes the onToolError hook for every failure path', async () => {
    const onToolError = vi.fn();
    const { log } = makeAuditLog();
    const registry = new ToolRegistry(onToolError, log, false);
    registry.register(logWaterTool);
    registry.register(throwingTool);

    await registry.execute('u1', 'does_not_exist', {});
    await registry.execute('u1', 'log_water', { cups: 'two' });
    await registry.execute('u1', 'always_throws', {});

    expect(onToolError).toHaveBeenCalledTimes(3);
  });

  it('exposes tool definitions for passing to the LLM provider', () => {
    const { log } = makeAuditLog();
    const registry = new ToolRegistry(undefined, log, false);
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

  it('does not require tenant context when tenant-scoped mode is off (tenantScoped: false)', async () => {
    const { log } = makeAuditLog();
    const registry = new ToolRegistry(undefined, log, false);
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

  it('enforces tenant-context checks by default (tenantScoped defaults to true), not by the presence of securityAuditLog alone', async () => {
    // Regression guard for RISK-009: before this task, the entire
    // tenant-enforcement block lived inside `if (this.securityAuditLog)`, so
    // simply passing a securityAuditLog was enough to opt in — there was no
    // way to have audit logging without tenant enforcement, and no way to
    // omit tenant enforcement other than by omitting the (then-optional)
    // securityAuditLog, which also silently disabled audit logging. Now
    // securityAuditLog is always mandatory, and tenant enforcement is a
    // separate, explicit `tenantScoped` flag that defaults to `true` (secure
    // by default) instead of being inferred from what was passed in.
    const { log, store } = makeAuditLog();
    const registry = new ToolRegistry(undefined, log);
    registry.register(tenantTool);

    const result = await registry.execute('u1', 'get_record', { id: 'r1' });

    expect(result.success).toBe(false);
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'missing_tenant_context' })
    );
  });
});

describe('ToolRegistry — securityAuditLog stays a required constructor argument (compile-time regression guard)', () => {
  it('fails to compile without a securityAuditLog, with or without onToolError', () => {
    // Type-level regression guard for RISK-009: if someone reverts the `?`
    // this task removed and makes securityAuditLog optional again, these
    // `@ts-expect-error` directives themselves become type errors (an
    // "unused '@ts-expect-error' directive" error), which `npm run
    // typecheck` (vitest --typecheck.only) already runs and enforces. This
    // is a compile-time-only assertion — nothing here needs to run or be
    // awaited.
    // @ts-expect-error securityAuditLog is a required constructor argument.
    new ToolRegistry();
    // @ts-expect-error securityAuditLog is required even when onToolError is supplied.
    new ToolRegistry(undefined);
  });
});
