import { GuardrailFilter } from '@aria/core';

export const exampleGuardrails = new GuardrailFilter({
  categories: [
    {
      key: 'weather',
      pattern: /\b(weather|forecast|temperature outside|rain today)\b/i,
      redirectMessage:
        "I'm not a weather app! I'm here to help with your habits. What are you working on today?",
    },
  ],
  overridePattern: /\b(habit|streak|check.?in|routine)\b/i,
});
