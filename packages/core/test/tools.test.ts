import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../src/tools';
import type { Tool } from '../src/types';

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
