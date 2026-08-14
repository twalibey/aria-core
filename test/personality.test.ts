import { describe, it, expect } from 'vitest';
import { EASE_PERSONALITY_CORE, buildSystemPrompt } from '../src/personality';
import type { AriaPromptConfig } from '../src/types';

describe('personality core', () => {
  it('includes all four EASE principles', () => {
    expect(EASE_PERSONALITY_CORE).toContain('Empathy');
    expect(EASE_PERSONALITY_CORE).toContain('Authenticity');
    expect(EASE_PERSONALITY_CORE).toContain('Simplicity');
    expect(EASE_PERSONALITY_CORE).toContain('Equity');
  });

  it('includes the never-break-character rule', () => {
    expect(EASE_PERSONALITY_CORE).toContain('Never break character');
  });

  it('buildSystemPrompt composes personality, expertise, rules, and context', () => {
    const config: AriaPromptConfig<{ name: string }> = {
      expertise: ['fitness coaching'],
      rules: ['never give medical advice'],
      injectContext: (ctx) => `User: ${ctx.name}`,
    };
    const prompt = buildSystemPrompt(config, { name: 'Sam' });
    expect(prompt).toContain('ARIA');
    expect(prompt).toContain('fitness coaching');
    expect(prompt).toContain('never give medical advice');
    expect(prompt).toContain('User: Sam');
  });
});
