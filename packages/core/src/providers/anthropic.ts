import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMMessage, ToolDefinition, LLMResponse } from '../types.js';

export interface AnthropicProviderConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(config: AnthropicProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    // Maintenance item: model IDs get deprecated and retired on a schedule, so this default needs periodic review (the previous `claude-sonnet-4-20250514` default was retired 2026-06-15).
    this.model = config.model ?? 'claude-sonnet-5';
    this.maxTokens = config.maxTokens ?? 1024;
  }

  async call(params: {
    systemPrompt: string;
    messages: LLMMessage[];
    tools?: ToolDefinition[];
  }): Promise<LLMResponse> {
    const response: any = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
      // ToolDefinition.parameters is a generic JSON Schema object; Anthropic's InputSchema type is stricter than we can statically prove here, though any real JSON Schema object satisfies it at runtime.
      tools: params.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as any,
      })),
    });

    let content = '';
    const toolCalls: { name: string; arguments: Record<string, unknown> }[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({ name: block.name, arguments: block.input as Record<string, unknown> });
      }
    }

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }
}
