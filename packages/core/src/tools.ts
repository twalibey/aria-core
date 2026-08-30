import Ajv, { type ValidateFunction } from 'ajv';
import type { Tool, ToolDefinition, ToolExecutionResult, TenantContext } from './types.js';
import type { SecurityAuditLog } from './security-audit-log.js';

const ajv = new Ajv();

export type ToolErrorHook = (params: {
  toolName: string;
  userId: string;
  error: string;
}) => void;

export class ToolRegistry {
  private tools = new Map<string, Tool<any>>();
  private validators = new Map<string, ValidateFunction>();

  constructor(
    private onToolError?: ToolErrorHook,
    private securityAuditLog?: SecurityAuditLog
  ) {}

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
    args: Record<string, unknown>,
    tenant?: TenantContext
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(toolName);
    const validate = this.validators.get(toolName);

    if (!tool || !validate) {
      const error = `Unknown tool: ${toolName}`;
      this.onToolError?.({ toolName, userId, error });
      return { success: false, error };
    }

    let scopedArgs = args;
    if (this.securityAuditLog) {
      if (!tenant) {
        const error = `Tool "${toolName}" requires tenant context but none was provided`;
        await this.securityAuditLog.logViolation({
          category: 'missing_tenant_context',
          detail: `${toolName} called without a TenantContext while tenant-scoped mode is enabled`,
        });
        this.onToolError?.({ toolName, userId, error });
        return { success: false, error };
      }
      if ('tenantId' in args) {
        await this.securityAuditLog.logViolation({
          category: 'llm_supplied_tenant_id',
          detail: `${toolName} call arguments included a "tenantId" field, which was stripped and ignored`,
          tenantId: tenant.tenantId,
        });
        const { tenantId: _ignored, ...rest } = args;
        scopedArgs = rest;
      }
    }

    if (!validate(scopedArgs)) {
      const error = `Invalid arguments for ${toolName}: ${ajv.errorsText(validate.errors)}`;
      this.onToolError?.({ toolName, userId, error });
      return { success: false, error };
    }

    try {
      const result = await tool.handler(userId, scopedArgs, tenant);
      return { success: true, result };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.onToolError?.({ toolName, userId, error });
      return { success: false, error };
    }
  }
}
