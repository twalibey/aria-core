import { describe, it, expect } from 'vitest';
import { ExampleContextProvider } from '../src/context-provider';

describe('ExampleContextProvider', () => {
  it('returns seeded data for a known user', async () => {
    const provider = new ExampleContextProvider();
    const ctx = await provider.buildContext('demo_user');
    expect(ctx.userName).toBe('Demo User');
    expect(ctx.habits).toHaveLength(2);
  });

  it('returns a safe default for an unknown user', async () => {
    const provider = new ExampleContextProvider();
    const ctx = await provider.buildContext('nobody');
    expect(ctx).toEqual({ userName: 'there', habits: [], lastCheckIn: null });
  });

  it('caches and invalidates independently of buildContext', async () => {
    const provider = new ExampleContextProvider();
    expect(await provider.getCachedContext('demo_user')).toBeNull();

    const ctx = await provider.buildContext('demo_user');
    await provider.cacheContext('demo_user', ctx);
    expect(await provider.getCachedContext('demo_user')).toEqual(ctx);

    await provider.invalidate('demo_user');
    expect(await provider.getCachedContext('demo_user')).toBeNull();
  });
});
