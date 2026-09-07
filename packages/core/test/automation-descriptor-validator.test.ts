import { describe, it, expect } from 'vitest';
import { AutomationDescriptorValidator, AUTOMATION_SAFE_FAILURE_MESSAGE } from '../src/automation-descriptor-validator';

describe('AutomationDescriptorValidator', () => {
  const validator = new AutomationDescriptorValidator([
    { triggerEvent: 'case_created', actionType: 'notify_case_owner' },
  ]);

  it('accepts a whitelisted descriptor', () => {
    const result = validator.validate({ triggerEvent: 'case_created', actionType: 'notify_case_owner' });
    expect(result).toEqual({ success: true, descriptor: { triggerEvent: 'case_created', actionType: 'notify_case_owner' } });
  });

  it('rejects a non-whitelisted triggerEvent/actionType pair with the sanitized message', () => {
    const result = validator.validate({ triggerEvent: 'donation_received', actionType: 'notify_finance' });
    expect(result).toEqual({ success: false, error: AUTOMATION_SAFE_FAILURE_MESSAGE });
  });

  it('rejects malformed input without throwing a raw error', () => {
    expect(() => validator.validate(null)).not.toThrow();
    expect(validator.validate(null)).toEqual({ success: false, error: AUTOMATION_SAFE_FAILURE_MESSAGE });
    expect(validator.validate({ triggerEvent: 123, actionType: {} })).toEqual({ success: false, error: AUTOMATION_SAFE_FAILURE_MESSAGE });
  });

  it('never accepts a tenantId field even if the descriptor tries to supply one', () => {
    const result = validator.validate({ triggerEvent: 'case_created', actionType: 'notify_case_owner', tenantId: 'attacker-supplied' });
    expect(result).toEqual({ success: true, descriptor: { triggerEvent: 'case_created', actionType: 'notify_case_owner' } });
    // tenantId is silently dropped, never present on the returned descriptor —
    // proves the descriptor shape structurally cannot carry a tenant field.
  });
});
