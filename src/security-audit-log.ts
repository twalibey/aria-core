import type { SecurityViolation, SecurityAuditLogConfig } from './types.js';

export type { SecurityAuditLogConfig } from './types.js';

export class SecurityAuditLog {
  constructor(private config: SecurityAuditLogConfig) {}

  async logViolation(violation: SecurityViolation): Promise<void> {
    await this.config.store(violation);
    await this.config.onCriticalViolation(violation);
  }
}
