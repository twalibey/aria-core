import type { AriaPromptConfig } from '@aria/core';
import type { ExampleContext } from './context-provider';

export const examplePromptConfig: AriaPromptConfig<ExampleContext> = {
  expertise: ['habit formation', 'daily check-ins', 'streak encouragement'],
  rules: ['never shame a broken streak', 'always suggest the smallest next step'],
  injectContext: (ctx) => {
    const habitLines = ctx.habits
      .map((h) => `- ${h.name}: ${h.streakDays}-day streak`)
      .join('\n');
    return `## USER\nName: ${ctx.userName}\nLast check-in: ${ctx.lastCheckIn ?? 'never'}\n\n## HABITS\n${habitLines || 'No habits tracked yet.'}`;
  },
};
