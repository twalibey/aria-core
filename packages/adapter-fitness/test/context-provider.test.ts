import { describe, it, expect } from 'vitest';
import { FitnessContextProvider } from '../src/context-provider';

describe('FitnessContextProvider', () => {
  it('returns a mocked context for a known user', async () => {
    const provider = new FitnessContextProvider();
    const context = await provider.buildContext('demo_user');

    expect(context.profile.name).toBe('Alex');
    expect(context.health.fitnessLevel).toBe('intermediate');
  });

  it('returns a sensible default context for an unknown user', async () => {
    const provider = new FitnessContextProvider();
    const context = await provider.buildContext('unknown_user');

    expect(context.profile.name).toBe('there');
    expect(context.health.limitations).toEqual([]);
  });

  it('caches and invalidates context per user', async () => {
    const provider = new FitnessContextProvider();
    expect(await provider.getCachedContext('demo_user')).toBeNull();

    const context = await provider.buildContext('demo_user');
    await provider.cacheContext('demo_user', context);
    expect(await provider.getCachedContext('demo_user')).toEqual(context);

    await provider.invalidate('demo_user');
    expect(await provider.getCachedContext('demo_user')).toBeNull();
  });
});
