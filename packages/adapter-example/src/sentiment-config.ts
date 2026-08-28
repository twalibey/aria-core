import { SentimentDetector } from '@aria/core';

export const exampleSentiment = new SentimentDetector({
  distressPattern: /\b(give up|hopeless|can'?t do this anymore)\b/i,
  negativePattern: /\b(frustrated|annoyed|failed|broke my streak)\b/gi,
  positivePattern: /\b(nailed it|proud|crushed it|streak intact)\b/gi,
  highEnergyPattern: /\b(let's go|pumped|ready)\b/i,
  lowEnergyPattern: /\b(tired|exhausted|meh)\b/i,
  requestKeywordPattern: /\b(log|track|check in|remind)\b/i,
  buildPromptSection: (hint) => {
    if (hint.mood === 'distressed') {
      return '\n## CURRENT MESSAGE CONTEXT\nThe user may be discouraged about their habits. Be gentle and encouraging.';
    }
    if (hint.mood === 'positive') {
      return '\n## CURRENT MESSAGE CONTEXT\nMatch their excitement about this win.';
    }
    return '';
  },
});
