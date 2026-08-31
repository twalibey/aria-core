import type {
  QueryWhitelist,
  QueryDescriptor,
  ResolvedQueryPlan,
  QueryPlanRunner,
  QuerySpecResult,
  TenantContext,
} from './types.js';
import type { SecurityAuditLog } from './security-audit-log.js';

const SAFE_FAILURE_MESSAGE = "I couldn't safely answer that — try rephrasing your question.";

export interface QuerySpecExecutorConfig {
  whitelist: QueryWhitelist;
  runner: QueryPlanRunner;
  securityAuditLog: SecurityAuditLog;
  defaultLimit?: number;
  maxLimit?: number;
}

export class QuerySpecExecutor {
  private defaultLimit: number;
  private maxLimit: number;

  constructor(private config: QuerySpecExecutorConfig) {
    this.defaultLimit = config.defaultLimit ?? 100;
    this.maxLimit = config.maxLimit ?? 100;
  }

  async execute(descriptor: QueryDescriptor, tenant: TenantContext): Promise<QuerySpecResult> {
    try {
      const table = this.config.whitelist.tables[descriptor.table];
      if (!table) {
        await this.config.securityAuditLog.logViolation({
          category: 'non_whitelisted_field',
          detail: `Requested non-whitelisted table "${descriptor.table}"`,
          tenantId: tenant.tenantId,
        });
        return { success: false, error: SAFE_FAILURE_MESSAGE };
      }

      const resolveColumn = async (key: string): Promise<unknown | undefined> => {
        const col = table.columns[key];
        if (!col) {
          await this.config.securityAuditLog.logViolation({
            category: 'non_whitelisted_field',
            detail: `Requested non-whitelisted column "${key}" on table "${descriptor.table}"`,
            tenantId: tenant.tenantId,
          });
          return undefined;
        }
        return col.ref;
      };

      const columnRefs: ResolvedQueryPlan['columns'] = [];
      for (const col of descriptor.columns) {
        const ref = await resolveColumn(col);
        if (ref === undefined) return { success: false, error: SAFE_FAILURE_MESSAGE };
        columnRefs.push({ key: col, ref });
      }

      const filters: ResolvedQueryPlan['filters'] = [];
      for (const filter of descriptor.filters ?? []) {
        if (filter.column === table.tenantColumnKey) {
          await this.config.securityAuditLog.logViolation({
            category: 'llm_supplied_tenant_id',
            detail: `Descriptor for table "${descriptor.table}" included its own filter on the tenant column ("${filter.column}"), which was ignored`,
            tenantId: tenant.tenantId,
          });
          continue;
        }
        const ref = await resolveColumn(filter.column);
        if (ref === undefined) return { success: false, error: SAFE_FAILURE_MESSAGE };
        filters.push({ ref, op: filter.op, value: filter.value });
      }

      let aggregation: ResolvedQueryPlan['aggregation'];
      if (descriptor.aggregation) {
        if (!table.aggregations.includes(descriptor.aggregation.fn)) {
          await this.config.securityAuditLog.logViolation({
            category: 'non_whitelisted_field',
            detail: `Requested non-whitelisted aggregation "${descriptor.aggregation.fn}" on table "${descriptor.table}"`,
            tenantId: tenant.tenantId,
          });
          return { success: false, error: SAFE_FAILURE_MESSAGE };
        }
        const ref = await resolveColumn(descriptor.aggregation.column);
        if (ref === undefined) return { success: false, error: SAFE_FAILURE_MESSAGE };
        aggregation = { fn: descriptor.aggregation.fn, ref };
      }

      let sort: ResolvedQueryPlan['sort'];
      if (descriptor.sort) {
        if (!table.sortableColumns.includes(descriptor.sort.column)) {
          await this.config.securityAuditLog.logViolation({
            category: 'non_whitelisted_field',
            detail: `Requested non-sortable column "${descriptor.sort.column}" on table "${descriptor.table}"`,
            tenantId: tenant.tenantId,
          });
          return { success: false, error: SAFE_FAILURE_MESSAGE };
        }
        const ref = await resolveColumn(descriptor.sort.column);
        if (ref === undefined) return { success: false, error: SAFE_FAILURE_MESSAGE };
        sort = { ref, direction: descriptor.sort.direction };
      }

      const plan: ResolvedQueryPlan = {
        table: descriptor.table,
        tableRef: table.tableRef,
        columns: columnRefs,
        filters,
        tenantFilter: { ref: table.columns[table.tenantColumnKey].ref, value: tenant.tenantId },
        aggregation,
        sort,
        // Clamp to at least 1 and floor to an integer — an LLM-supplied
        // `limit` that's negative, zero, or non-integer would otherwise reach
        // the runner as-is. This fails closed today via a DB-level rejection
        // (or, depending on the driver, an unintended `LIMIT 0`/negative
        // clause), but guarding it explicitly here is more robust.
        limit: Math.max(1, Math.min(Math.floor(descriptor.limit ?? this.defaultLimit), this.maxLimit)),
      };

      const rows = await this.config.runner(plan);
      return { success: true, rows };
    } catch {
      return { success: false, error: SAFE_FAILURE_MESSAGE };
    }
  }
}
