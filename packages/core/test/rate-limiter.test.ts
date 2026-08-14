import { describe, it, expect } from 'vitest';
import { RateLimiter, getStartOfDayInTimezone } from '../src/rate-limiter';
import type { AriaHistoryStore, AriaMessage } from '../src/types';

function stubHistoryStore(countResult: number): AriaHistoryStore {
  return {
    async getRecentMessages() {
      return [];
    },
    async saveMessage(_userId, message) {
      return { id: '1', createdAt: new Date(), ...message } as AriaMessage;
    },
    async clearMessages() {},
    async countMessagesSince() {
      return countResult;
    },
  };
}

describe('getStartOfDayInTimezone', () => {
  it('computes midnight Eastern time correctly across the UTC offset', () => {
    const now = new Date('2026-08-13T15:00:00Z'); // 11am EDT
    const start = getStartOfDayInTimezone(now, 'America/New_York');
    expect(start.toISOString()).toBe('2026-08-13T04:00:00.000Z');
  });

  it('computes midnight UTC correctly when timezone is UTC', () => {
    const now = new Date('2026-08-13T15:00:00Z');
    const start = getStartOfDayInTimezone(now, 'UTC');
    expect(start.toISOString()).toBe('2026-08-13T00:00:00.000Z');
  });
});

describe('RateLimiter', () => {
  it('allows unlimited messages for premium users regardless of usage', async () => {
    const limiter = new RateLimiter(stubHistoryStore(999), { freeLimit: 3 });
    const result = await limiter.check('u1', 'premium', 'UTC');
    expect(result).toEqual({ allowed: true, used: 0, limit: null, remaining: null });
  });

  it('allows a free user under the daily limit', async () => {
    const limiter = new RateLimiter(stubHistoryStore(1), { freeLimit: 3 });
    const result = await limiter.check('u1', 'free', 'UTC');
    expect(result).toEqual({ allowed: true, used: 1, limit: 3, remaining: 2 });
  });

  it('blocks a free user who has hit the daily limit', async () => {
    const limiter = new RateLimiter(stubHistoryStore(3), { freeLimit: 3 });
    const result = await limiter.check('u1', 'free', 'UTC');
    expect(result).toEqual({ allowed: false, used: 3, limit: 3, remaining: 0 });
  });
});
