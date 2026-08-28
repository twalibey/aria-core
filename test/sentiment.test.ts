import { describe, it, expect } from 'vitest';
import { SentimentDetector } from '../src/sentiment';

function makeDetector() {
  return new SentimentDetector({
    distressPattern: /\b(give up|hopeless)\b/i,
    negativePattern: /\b(frustrated|tired|sucks)\b/gi,
    positivePattern: /\b(awesome|proud|crushed it)\b/gi,
    highEnergyPattern: /\b(let's go|pumped)\b/i,
    lowEnergyPattern: /\b(tired|exhausted)\b/i,
    requestKeywordPattern: /\b(log|track|show)\b/i,
    buildPromptSection: (hint) => `## SENTIMENT\nmood=${hint.mood} energy=${hint.energy} intent=${hint.intent}`,
  });
}

describe('SentimentDetector.detect', () => {
  it('short-circuits to distressed on a distress pattern match, ignoring everything else', () => {
    const result = makeDetector().detect('I want to give up, this awesome plan sucks');
    expect(result).toEqual({ mood: 'distressed', energy: 'low', intent: 'venting' });
  });

  it('detects positive mood when positive matches outnumber negative', () => {
    const result = makeDetector().detect('I crushed it today, feeling awesome');
    expect(result.mood).toBe('positive');
  });

  it('detects negative mood when negative matches outnumber positive', () => {
    const result = makeDetector().detect('I am so frustrated and tired today');
    expect(result.mood).toBe('negative');
  });

  it('defaults to neutral mood with no matches', () => {
    const result = makeDetector().detect('what time is my appointment');
    expect(result.mood).toBe('neutral');
  });

  it('detects high energy', () => {
    expect(makeDetector().detect("let's go, ready for this").energy).toBe('high');
  });

  it('detects low energy', () => {
    expect(makeDetector().detect('so tired today').energy).toBe('low');
  });

  it('defaults to medium energy', () => {
    expect(makeDetector().detect('what should I eat').energy).toBe('medium');
  });

  it('detects question intent from a question mark', () => {
    expect(makeDetector().detect('is this a good plan?').intent).toBe('question');
  });

  it('detects question intent from a question word with no question mark', () => {
    expect(makeDetector().detect('how do I improve my form').intent).toBe('question');
  });

  it('detects venting intent from negative words with no question mark', () => {
    expect(makeDetector().detect('this is so frustrated').intent).toBe('venting');
  });

  it('detects celebration intent from positive words', () => {
    expect(makeDetector().detect('I am so proud of myself').intent).toBe('celebration');
  });

  it('detects request intent from a request keyword', () => {
    expect(makeDetector().detect('please log this for me')).toMatchObject({ intent: 'request' });
  });

  it('detects greeting intent', () => {
    expect(makeDetector().detect('hey there').intent).toBe('greeting');
  });

  it('defaults to unknown intent', () => {
    expect(makeDetector().detect('purple elephants dance sideways').intent).toBe('unknown');
  });

  it('counts matches correctly even when the config pattern has no global flag', () => {
    const detector = new SentimentDetector({
      distressPattern: /give up/i,
      negativePattern: /frustrated/i, // deliberately non-global
      positivePattern: /awesome/i, // deliberately non-global
      highEnergyPattern: /pumped/i,
      lowEnergyPattern: /tired/i,
      requestKeywordPattern: /log/i,
    });
    // Two occurrences of "frustrated" must still count as 2, not be miscounted
    // due to a missing 'g' flag on the caller-supplied pattern.
    const result = detector.detect('frustrated frustrated');
    expect(result.mood).toBe('negative');
  });
});

describe('SentimentDetector.buildPromptSection', () => {
  it('delegates to the configured builder', () => {
    const hint = { mood: 'positive' as const, energy: 'high' as const, intent: 'celebration' as const };
    expect(makeDetector().buildPromptSection(hint)).toBe(
      '## SENTIMENT\nmood=positive energy=high intent=celebration'
    );
  });

  it('returns an empty string when no builder is configured', () => {
    const detector = new SentimentDetector({
      distressPattern: /x/,
      negativePattern: /x/,
      positivePattern: /x/,
      highEnergyPattern: /x/,
      lowEnergyPattern: /x/,
      requestKeywordPattern: /x/,
    });
    expect(detector.buildPromptSection({ mood: 'neutral', energy: 'medium', intent: 'unknown' })).toBe('');
  });
});
