import type { GuardrailCheckResult } from './types.js';

export interface GuardrailCategory {
  key: string;
  pattern: RegExp;
  redirectMessage: string;
}

export interface GuardrailFilterConfig {
  categories: GuardrailCategory[];
  /** If this matches, the message is allowed through even if it also matches a category — checked before categories, not after. */
  overridePattern: RegExp;
  /** Messages shorter than this are always allowed. Defaults to 15, matching the real My Body threshold. */
  shortMessageThreshold?: number;
}

export class GuardrailFilter {
  private categories: GuardrailCategory[];
  private overridePattern: RegExp;
  private shortMessageThreshold: number;

  constructor(config: GuardrailFilterConfig) {
    this.categories = config.categories;
    this.overridePattern = config.overridePattern;
    this.shortMessageThreshold = config.shortMessageThreshold ?? 15;
  }

  check(message: string): GuardrailCheckResult {
    if (message.length < this.shortMessageThreshold) {
      return { allowed: true };
    }

    if (this.overridePattern.test(message)) {
      return { allowed: true };
    }

    for (const category of this.categories) {
      if (category.pattern.test(message)) {
        return { allowed: false, redirectMessage: category.redirectMessage };
      }
    }

    return { allowed: true };
  }
}
