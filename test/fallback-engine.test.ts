import { describe, it, expect } from 'vitest';
import { FallbackEngine } from '../src/fallback-engine';

describe('FallbackEngine', () => {
  const engine = new FallbackEngine(
    [
      { match: /workout|exercise/, response: 'Workout response' },
      { match: /sleep|tired/, response: 'Sleep response' },
    ],
    'Default response'
  );

  it('matches the first topic whose pattern applies', () => {
    expect(engine.respond('I did a great workout today')).toBe('Workout response');
  });

  it('lowercases the message before matching, so case does not matter', () => {
    expect(engine.respond('WORKOUT time')).toBe('Workout response');
  });

  it('falls back to the default response when nothing matches', () => {
    expect(engine.respond('what is the weather like')).toBe('Default response');
  });
});
