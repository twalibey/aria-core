import { describe, it, expect } from 'vitest';
import { examplePromptConfig } from '../src/prompt-config';

describe('examplePromptConfig', () => {
  it('lists habits with their streaks', () => {
    const prompt = examplePromptConfig.injectContext({
      userName: 'Sam',
      habits: [{ name: 'Reading', streakDays: 3 }],
      lastCheckIn: '2026-08-12',
    });
    expect(prompt).toContain('Sam');
    expect(prompt).toContain('Reading: 3-day streak');
  });

  it('handles a user with no habits yet', () => {
    const prompt = examplePromptConfig.injectContext({
      userName: 'Sam',
      habits: [],
      lastCheckIn: null,
    });
    expect(prompt).toContain('No habits tracked yet.');
    expect(prompt).toContain('Last check-in: never');
  });
});
