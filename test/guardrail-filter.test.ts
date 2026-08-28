import { describe, it, expect } from 'vitest';
import { GuardrailFilter } from '../src/guardrail-filter';

function makeFilter() {
  return new GuardrailFilter({
    categories: [
      { key: 'finance', pattern: /\b(stock market|invest)\b/i, redirectMessage: 'finance redirect' },
      { key: 'legal', pattern: /\b(lawyer|lawsuit)\b/i, redirectMessage: 'legal redirect' },
    ],
    overridePattern: /\b(workout|nutrition)\b/i,
    defaultRedirectMessage: 'default redirect',
  });
}

describe('GuardrailFilter', () => {
  it('always allows messages shorter than the short-message threshold', () => {
    const filter = makeFilter();
    expect(filter.check('lawyer').allowed).toBe(true);
  });

  it('allows a message through when it matches the override pattern, even if it also matches a category', () => {
    const filter = makeFilter();
    const result = filter.check('how does stress affect my workout performance vs a lawyer job');
    expect(result.allowed).toBe(true);
  });

  it('blocks a message matching an off-topic category and returns its redirect message', () => {
    const filter = makeFilter();
    const result = filter.check('should I invest in the stock market this year');
    expect(result.allowed).toBe(false);
    expect(result.redirectMessage).toBe('finance redirect');
  });

  it('checks categories in order and returns the first match', () => {
    const filter = makeFilter();
    const result = filter.check('do I need a lawyer for my lawsuit');
    expect(result.redirectMessage).toBe('legal redirect');
  });

  it('allows a message that matches no category', () => {
    const filter = makeFilter();
    const result = filter.check('what is a good breakfast to eat before a long run today');
    expect(result.allowed).toBe(true);
  });

  it('respects a custom shortMessageThreshold', () => {
    const filter = new GuardrailFilter({
      categories: [{ key: 'finance', pattern: /invest/i, redirectMessage: 'finance redirect' }],
      overridePattern: /workout/i,
      defaultRedirectMessage: 'default redirect',
      shortMessageThreshold: 3,
    });
    // "invest" is 6 chars, over the threshold of 3, so it should be checked and blocked.
    expect(filter.check('invest').allowed).toBe(false);
  });
});
