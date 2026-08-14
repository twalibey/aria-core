import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function() {
    return {
      messages: { create: mockCreate },
    };
  }),
}));

import { AnthropicProvider } from '../../src/providers/anthropic';

describe('AnthropicProvider', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('maps a plain text response from content blocks', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Hello there' }] });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    const result = await provider.call({ systemPrompt: 'sys', messages: [] });

    expect(result).toEqual({ content: 'Hello there', toolCalls: undefined });
  });

  it('maps tool_use content blocks to tool calls', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: '' },
        { type: 'tool_use', name: 'log_water', input: { cups: 2 } },
      ],
    });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    const result = await provider.call({ systemPrompt: 'sys', messages: [] });

    expect(result.toolCalls).toEqual([{ name: 'log_water', arguments: { cups: 2 } }]);
  });

  it('sends the system prompt as a top-level field, not inside messages', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await provider.call({ systemPrompt: 'be nice', messages: [{ role: 'user', content: 'hi' }] });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'be nice',
        messages: [{ role: 'user', content: 'hi' }],
      })
    );
  });

  it('explicitly disables extended thinking so maxTokens covers only the response', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await provider.call({ systemPrompt: 'sys', messages: [] });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        thinking: { type: 'disabled' },
      })
    );
  });

  it('translates tool definitions to input_schema shape', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await provider.call({
      systemPrompt: 'sys',
      messages: [],
      tools: [{ name: 'log_water', description: 'log water', parameters: { type: 'object' } }],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{ name: 'log_water', description: 'log water', input_schema: { type: 'object' } }],
      })
    );
  });
});
