export const AUTOMATION_SAFE_FAILURE_MESSAGE =
  "I can't build that yet. Here's what I can build today.";

export interface AutomationWhitelistEntry {
  triggerEvent: string;
  actionType: string;
}

export interface ProposedAutomationDescriptor {
  triggerEvent: string;
  actionType: string;
}

export type AutomationValidationResult =
  | { success: true; descriptor: ProposedAutomationDescriptor }
  | { success: false; error: string };

export class AutomationDescriptorValidator {
  constructor(private whitelist: AutomationWhitelistEntry[]) {}

  validate(descriptor: unknown): AutomationValidationResult {
    try {
      if (typeof descriptor !== 'object' || descriptor === null) {
        return { success: false, error: AUTOMATION_SAFE_FAILURE_MESSAGE };
      }
      const candidate = descriptor as Record<string, unknown>;
      const triggerEvent = candidate.triggerEvent;
      const actionType = candidate.actionType;
      if (typeof triggerEvent !== 'string' || typeof actionType !== 'string') {
        return { success: false, error: AUTOMATION_SAFE_FAILURE_MESSAGE };
      }
      const matched = this.whitelist.some(
        (entry) => entry.triggerEvent === triggerEvent && entry.actionType === actionType,
      );
      if (!matched) {
        return { success: false, error: AUTOMATION_SAFE_FAILURE_MESSAGE };
      }
      return { success: true, descriptor: { triggerEvent, actionType } };
    } catch {
      return { success: false, error: AUTOMATION_SAFE_FAILURE_MESSAGE };
    }
  }
}
