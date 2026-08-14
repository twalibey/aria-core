import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function() {
    return {
      chat: { completions: { create: mockCreate } },
    };
  }),
}));

import { OpenRouterProvider } from '../../src/providers/openrouter';

describe('OpenRouterProvider', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('maps a plain text response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hello there', tool_calls: undefined } }],
    });

    const provider = new OpenRouterProvider({ apiKey: 'test-key' });
    const result = await provider.call({ systemPrompt: 'sys', messages: [] });

    expect(result).toEqual({ content: 'Hello there', toolCalls: undefined });
  });

  it('maps tool calls, parsing JSON arguments', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [{ function: { name: 'log_water', arguments: '{"cups":2}' } }],
          },
        },
      ],
    });

    const provider = new OpenRouterProvider({ apiKey: 'test-key' });
    const result = await provider.call({ systemPrompt: 'sys', messages: [] });

    expect(result.toolCalls).toEqual([{ name: 'log_water', arguments: { cups: 2 } }]);
  });

  it('passes tool definitions through in OpenAI function-calling shape', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] });

    const provider = new OpenRouterProvider({ apiKey: 'test-key' });
    await provider.call({
      systemPrompt: 'sys',
      messages: [],
      tools: [{ name: 'log_water', description: 'log water', parameters: { type: 'object' } }],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          {
            type: 'function',
            function: {
              name: 'log_water',
              description: 'log water',
              parameters: { type: 'object' },
            },
          },
        ],
      })
    );
  });
});
