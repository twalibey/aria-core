import OpenAI from 'openai';
import type { LLMProvider, LLMMessage, ToolDefinition, LLMResponse } from '../types.js';

export interface OpenRouterProviderConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export class OpenRouterProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(config: OpenRouterProviderConfig) {
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: config.apiKey,
    });
    // Maintenance item: model IDs get deprecated and retired on a schedule, so this default needs periodic review (the previous `anthropic/claude-sonnet-4` default was retired 2026-06-15).
    this.model = config.model ?? 'anthropic/claude-sonnet-5';
    this.maxTokens = config.maxTokens ?? 1024;
  }

  async call(params: {
    systemPrompt: string;
    messages: LLMMessage[];
    tools?: ToolDefinition[];
  }): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: params.systemPrompt },
        ...params.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      tools: params.tools?.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          // ToolDefinition.parameters is a generic JSON Schema object; OpenAI's FunctionParameters type is stricter than we can statically prove here, though any real JSON Schema object satisfies it at runtime.
          parameters: t.parameters as Record<string, unknown>,
        },
      })),
    });

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls?.map((tc: any) => ({
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: choice.message.content ?? '',
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
