import Ajv, { type ValidateFunction } from 'ajv';
import type { Tool, ToolDefinition, ToolExecutionResult } from './types.js';

const ajv = new Ajv();

export type ToolErrorHook = (params: {
  toolName: string;
  userId: string;
  error: string;
}) => void;

export class ToolRegistry {
  private tools = new Map<string, Tool<any>>();
  private validators = new Map<string, ValidateFunction>();

  constructor(private onToolError?: ToolErrorHook) {}

  register(tool: Tool<any>): void {
    this.tools.set(tool.definition.name, tool);
    this.validators.set(tool.definition.name, ajv.compile(tool.definition.parameters));
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(
    userId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(toolName);
    const validate = this.validators.get(toolName);

    if (!tool || !validate) {
      const error = `Unknown tool: ${toolName}`;
      this.onToolError?.({ toolName, userId, error });
      return { success: false, error };
    }

    if (!validate(args)) {
      const error = `Invalid arguments for ${toolName}: ${ajv.errorsText(validate.errors)}`;
      this.onToolError?.({ toolName, userId, error });
      return { success: false, error };
    }

    try {
      const result = await tool.handler(userId, args);
      return { success: true, result };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.onToolError?.({ toolName, userId, error });
      return { success: false, error };
    }
  }
}
