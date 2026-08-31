import { describe, it, expect, vi } from 'vitest';
import { SecurityAuditLog } from '../src/security-audit-log';

describe('SecurityAuditLog', () => {
  it('stores the violation and calls onCriticalViolation', async () => {
    const store = vi.fn().mockResolvedValue(undefined);
    const onCriticalViolation = vi.fn();
    const log = new SecurityAuditLog({ store, onCriticalViolation });

    await log.logViolation({
      category: 'llm_supplied_tenant_id',
      detail: 'test violation',
      tenantId: 'tenant-1',
    });

    expect(store).toHaveBeenCalledWith({
      category: 'llm_supplied_tenant_id',
      detail: 'test violation',
      tenantId: 'tenant-1',
    });
    expect(onCriticalViolation).toHaveBeenCalledWith({
      category: 'llm_supplied_tenant_id',
      detail: 'test violation',
      tenantId: 'tenant-1',
    });
  });

  it('cannot be constructed without onCriticalViolation', () => {
    // @ts-expect-error onCriticalViolation is required
    () => new SecurityAuditLog({ store: async () => {} });
  });
});
