import type { AriaHistoryStore, RateLimitResult, SubscriptionTier } from './types.js';

export interface RateLimiterConfig {
  freeLimit: number;
}

export function getStartOfDayInTimezone(now: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;

  const asUTC = new Date(`${year}-${month}-${day}T00:00:00Z`);
  const offsetMs = getTimezoneOffsetMs(asUTC, timezone);
  return new Date(asUTC.getTime() - offsetMs);
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const asIfUTC = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second'))
  );
  return asIfUTC - date.getTime();
}

export class RateLimiter {
  constructor(
    private historyStore: AriaHistoryStore,
    private config: RateLimiterConfig
  ) {}

  async check(
    userId: string,
    tier: SubscriptionTier,
    timezone: string,
    now: Date = new Date()
  ): Promise<RateLimitResult> {
    if (tier === 'premium') {
      return { allowed: true, used: 0, limit: null, remaining: null };
    }

    const startOfDay = getStartOfDayInTimezone(now, timezone);
    const used = await this.historyStore.countMessagesSince(userId, startOfDay, 'user');
    const remaining = Math.max(0, this.config.freeLimit - used);

    return {
      allowed: used < this.config.freeLimit,
      used,
      limit: this.config.freeLimit,
      remaining,
    };
  }
}
