import { describe, it, expect } from 'vitest';
import { fitnessSentiment } from '../src/sentiment-config';

describe('fitnessSentiment', () => {
  it('detects distress and produces the workout-suppression instruction', () => {
    const hint = fitnessSentiment.detect("I can't take this anymore, I want to give up");
    expect(hint.mood).toBe('distressed');
    expect(fitnessSentiment.buildPromptSection(hint)).toContain('Do NOT jump to workout suggestions');
  });

  it('detects celebration from fitness-specific positive vocabulary', () => {
    const hint = fitnessSentiment.detect('I just hit a new PR on my deadlift, crushed it!');
    expect(hint.mood).toBe('positive');
    expect(hint.intent).toBe('celebration');
    expect(fitnessSentiment.buildPromptSection(hint)).toContain('Celebrate with them');
  });

  it('detects low energy and produces the low-effort instruction', () => {
    const hint = fitnessSentiment.detect('so tired and drained today');
    expect(hint.energy).toBe('low');
    expect(fitnessSentiment.buildPromptSection(hint)).toContain('low-effort');
  });

  it('detects venting from negative wellness language', () => {
    const hint = fitnessSentiment.detect('I am so frustrated with my lack of progress');
    expect(hint.intent).toBe('venting');
    expect(fitnessSentiment.buildPromptSection(hint)).toContain('Listen first');
  });

  it('does not include the distress warning when sentiment is neutral', () => {
    const hint = fitnessSentiment.detect('what time should I work out today');
    expect(fitnessSentiment.buildPromptSection(hint)).not.toContain('IMPORTANT');
  });
});
