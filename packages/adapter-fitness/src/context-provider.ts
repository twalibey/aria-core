import type { AriaContextProvider } from '@aria/core';

export interface FitnessContext {
  profile: {
    name: string;
    timezone: string;
    subscriptionTier: 'free' | 'premium';
  };
  health: {
    fitnessLevel: 'beginner' | 'intermediate' | 'advanced';
    limitations: string[];
    allergies: string[];
    dietFramework: string | null;
    equipmentAvailable: string[];
  };
}

// Mocked/injected data — no real database, matching the "standalone proof"
// scope decision in docs/superpowers/specs/2026-08-28-aria-adapter-fitness-design.md.
const MOCK_USERS: Record<string, FitnessContext> = {
  demo_user: {
    profile: { name: 'Alex', timezone: 'America/New_York', subscriptionTier: 'free' },
    health: {
      fitnessLevel: 'intermediate',
      limitations: ['lower back'],
      allergies: ['peanuts'],
      dietFramework: null,
      equipmentAvailable: ['dumbbells', 'resistance bands'],
    },
  },
};

const DEFAULT_CONTEXT: FitnessContext = {
  profile: { name: 'there', timezone: 'UTC', subscriptionTier: 'free' },
  health: {
    fitnessLevel: 'beginner',
    limitations: [],
    allergies: [],
    dietFramework: null,
    equipmentAvailable: [],
  },
};

export class FitnessContextProvider implements AriaContextProvider<FitnessContext> {
  private cache = new Map<string, FitnessContext>();

  async buildContext(userId: string): Promise<FitnessContext> {
    return MOCK_USERS[userId] ?? DEFAULT_CONTEXT;
  }

  async getCachedContext(userId: string): Promise<FitnessContext | null> {
    return this.cache.get(userId) ?? null;
  }

  async cacheContext(userId: string, context: FitnessContext): Promise<void> {
    this.cache.set(userId, context);
  }

  async invalidate(userId: string): Promise<void> {
    this.cache.delete(userId);
  }
}
