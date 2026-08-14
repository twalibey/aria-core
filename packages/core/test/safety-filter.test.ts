import { describe, it, expect } from 'vitest';
import { checkSafety } from '../src/safety-filter';

describe('checkSafety', () => {
  it('blocks self-harm language', () => {
    const result = checkSafety("I've been thinking about hurting myself");
    expect(result.blocked).toBe(true);
    expect(result.response).toBeTruthy();
  });

  it('blocks acute medical symptom language', () => {
    expect(checkSafety('I have chest pain and I feel dizzy').blocked).toBe(true);
    expect(checkSafety("I can't breathe right now").blocked).toBe(true);
  });

  it('does not block normal fitness questions, including ones that share keywords', () => {
    expect(checkSafety('What should I eat before a workout?').blocked).toBe(false);
    expect(checkSafety('My chest workout left me sore').blocked).toBe(false);
  });

  it('allows a custom response to be supplied', () => {
    const result = checkSafety('I want to end my life', 'custom response');
    expect(result.response).toBe('custom response');
  });

  it('blocks suicidal ideation (suicidal)', () => {
    expect(checkSafety('I feel suicidal lately').blocked).toBe(true);
  });

  it('blocks suicidal ideation (suicide)', () => {
    expect(checkSafety('I am considering suicide').blocked).toBe(true);
  });
});
