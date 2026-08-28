import { describe, it, expect } from 'vitest';
import { fitnessPromptConfig } from '../src/prompt-config';
import type { FitnessContext } from '../src/context-provider';

describe('fitnessPromptConfig', () => {
  it('injects the user profile and health fields into the context section', () => {
    const context: FitnessContext = {
      profile: { name: 'Alex', timezone: 'America/New_York', subscriptionTier: 'free' },
      health: {
        fitnessLevel: 'intermediate',
        limitations: ['lower back'],
        allergies: ['peanuts'],
        dietFramework: 'halal',
        equipmentAvailable: ['dumbbells'],
      },
    };

    const section = fitnessPromptConfig.injectContext(context);

    expect(section).toContain('Alex');
    expect(section).toContain('intermediate');
    expect(section).toContain('lower back');
    expect(section).toContain('peanuts');
    expect(section).toContain('halal');
    expect(section).toContain('dumbbells');
  });

  it('renders sensible defaults for empty arrays and null fields', () => {
    const context: FitnessContext = {
      profile: { name: 'there', timezone: 'UTC', subscriptionTier: 'free' },
      health: {
        fitnessLevel: 'beginner',
        limitations: [],
        allergies: [],
        dietFramework: null,
        equipmentAvailable: [],
      },
    };

    const section = fitnessPromptConfig.injectContext(context);

    expect(section).toContain('none disclosed');
    expect(section).toContain('none specified');
  });

  it('declares fitness expertise and hard rules', () => {
    expect(fitnessPromptConfig.expertise.length).toBeGreaterThan(0);
    expect(fitnessPromptConfig.rules.length).toBeGreaterThan(0);
  });
});
