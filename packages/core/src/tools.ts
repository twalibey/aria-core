import Ajv, { type ValidateFunction } from 'ajv';
import type { Tool, ToolDefinition, ToolExecutionResult, TenantContext } from './types.js';
import type { SecurityAuditLog } from './security-audit-log.js';

const ajv = new Ajv();

// Known spellings a tool-calling LLM might use for a tenant-identity field.
// Not a generic fuzzy-matcher — just the concrete spellings this codebase
// actually uses (camelCase in this package's own API, snake_case in the
// QuerySpecExecutor/whitelist convention used by adapters like CorpFlow).
const TENANT_ID_ARG_SPELLINGS = ['tenantId', 'tenant_id'] as const;

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
    try {
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
        const suppliedSpellings = TENANT_ID_ARG_SPELLINGS.filter((key) => key in args);
        if (suppliedSpellings.length > 0) {
          await this.securityAuditLog.logViolation({
            category: 'llm_supplied_tenant_id',
            detail: `${toolName} call arguments included a tenant-identity field (${suppliedSpellings.join(', ')}), which was stripped and ignored`,
            tenantId: tenant.tenantId,
          });
          scopedArgs = Object.fromEntries(
            Object.entries(args).filter(([key]) => !(suppliedSpellings as readonly string[]).includes(key))
          );
        }
      }

      if (!validate(scopedArgs)) {
        const error = `Invalid arguments for ${toolName}: ${ajv.errorsText(validate.errors)}`;
        this.onToolError?.({ toolName, userId, error });
        return { success: false, error };
      }

      const result = await tool.handler(userId, scopedArgs, tenant);
      return { success: true, result };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.onToolError?.({ toolName, userId, error });
      return { success: false, error };
    }
  }
}
