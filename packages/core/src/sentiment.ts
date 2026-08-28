import type { SentimentHint } from './types.js';

export interface SentimentDetectorConfig {
  distressPattern: RegExp;
  negativePattern: RegExp;
  positivePattern: RegExp;
  highEnergyPattern: RegExp;
  lowEnergyPattern: RegExp;
  requestKeywordPattern: RegExp;
  buildPromptSection?: (hint: SentimentHint) => string;
}

// Generic across every domain — real source confirms these two patterns
// contain no domain-specific vocabulary, unlike the six configured ones above.
const QUESTION_WORD_PATTERN = /\b(how|what|why|when|should|can|could|is it|do you|does|will)\b/i;
const GREETING_PATTERN = /^(hi|hello|hey|what'?s up|good morning|good evening|good afternoon|yo|sup)/i;

/** Counts matches regardless of whether the caller's pattern has a global flag. */
function countMatches(text: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return (text.match(global) || []).length;
}

export class SentimentDetector {
  constructor(private config: SentimentDetectorConfig) {}

  detect(message: string): SentimentHint {
    const lower = message.toLowerCase();

    if (this.config.distressPattern.test(lower)) {
      return { mood: 'distressed', energy: 'low', intent: 'venting' };
    }

    const negativeCount = countMatches(lower, this.config.negativePattern);
    const positiveCount = countMatches(lower, this.config.positivePattern);

    let energy: SentimentHint['energy'] = 'medium';
    if (this.config.highEnergyPattern.test(lower)) energy = 'high';
    else if (this.config.lowEnergyPattern.test(lower)) energy = 'low';

    let intent: SentimentHint['intent'] = 'unknown';
    if (/\?/.test(message) || QUESTION_WORD_PATTERN.test(lower)) {
      intent = 'question';
    } else if (negativeCount > 0 && !/\?/.test(message)) {
      intent = 'venting';
    } else if (positiveCount > 0) {
      intent = 'celebration';
    } else if (this.config.requestKeywordPattern.test(lower)) {
      intent = 'request';
    } else if (GREETING_PATTERN.test(lower)) {
      intent = 'greeting';
    }

    let mood: SentimentHint['mood'] = 'neutral';
    if (positiveCount > negativeCount) mood = 'positive';
    else if (negativeCount > 0) mood = 'negative';

    return { mood, energy, intent };
  }

  buildPromptSection(hint: SentimentHint): string {
    return this.config.buildPromptSection?.(hint) ?? '';
  }
}
