import { describe, it, expect } from 'vitest';
import { fitnessGuardrails } from '../src/guardrails-config';

describe('fitnessGuardrails', () => {
  it('allows a wellness message even if it also mentions an off-topic keyword', () => {
    const result = fitnessGuardrails.check('how does stress affect my workout performance');
    expect(result.allowed).toBe(true);
  });

  it.each([
    ['should I invest in the stock market or crypto', 'finance'],
    ['can you write me some python code', 'programming'],
    ['what do you think about the election this year', 'politics'],
    ['I need legal advice from a lawyer about a lawsuit', 'legal'],
    ['help me solve this calculus homework problem', 'academics'],
    ['write me a short story about a dragon', 'creative_writing'],
  ])('blocks an off-topic %s message', (message) => {
    const result = fitnessGuardrails.check(message);
    expect(result.allowed).toBe(false);
    expect(result.redirectMessage).toBeTruthy();
  });

  it('allows an on-topic fitness message through', () => {
    const result = fitnessGuardrails.check('what should my macros look like on a cutting phase');
    expect(result.allowed).toBe(true);
  });

  it('always allows short messages regardless of content', () => {
    expect(fitnessGuardrails.check('lawyer').allowed).toBe(true);
  });
});
