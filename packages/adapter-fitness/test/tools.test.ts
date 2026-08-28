import { describe, it, expect } from 'vitest';
import { createFitnessTools, type FitnessDataStore } from '../src/tools';

function makeStore(): FitnessDataStore & {
  hydrationLogs: { userId: string; cups: number }[];
  moodLogs: { userId: string; moodRating: number; energyRating: number; stressLevel: number; note: string | null }[];
} {
  const hydrationLogs: { userId: string; cups: number }[] = [];
  const moodLogs: { userId: string; moodRating: number; energyRating: number; stressLevel: number; note: string | null }[] = [];
  return {
    hydrationLogs,
    moodLogs,
    async logWater(userId, cups) {
      hydrationLogs.push({ userId, cups });
    },
    async logMood(userId, moodRating, energyRating, stressLevel, note) {
      moodLogs.push({ userId, moodRating, energyRating, stressLevel, note });
    },
    async getWeeklyStats() {
      return { workoutsThisWeek: 3, avgSleepHours: 7.5, avgMood: 4, caloriesToday: 1800 };
    },
    async getSleepTrend() {
      return [{ date: '1/1/2026', hours: 7, quality: 4 }];
    },
    async getWorkoutHistory() {
      return [{ title: 'Leg day', durationMinutes: 45, rpe: 7, date: '1/1/2026' }];
    },
    async getNutritionToday() {
      return { meals: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
    },
    async getMoodTrend() {
      return [{ date: '1/1/2026', mood: 4, energy: 3, stress: 2 }];
    },
    async getPersonalRecords() {
      return [{ exercise: 'Bench press', type: 'weight', value: 185, unit: 'lb', date: '1/1/2026' }];
    },
  };
}

describe('createFitnessTools', () => {
  it('produces exactly the 8 real tools with mutatesContext set only on log_water and log_mood', () => {
    const tools = createFitnessTools(makeStore());
    const names = tools.map((t) => t.definition.name);
    expect(names).toEqual([
      'log_water',
      'log_mood',
      'get_weekly_stats',
      'get_sleep_trend',
      'get_workout_history',
      'get_nutrition_today',
      'get_mood_trend',
      'get_personal_records',
    ]);
    expect(tools.find((t) => t.definition.name === 'log_water')!.definition.mutatesContext).toBe(true);
    expect(tools.find((t) => t.definition.name === 'log_mood')!.definition.mutatesContext).toBe(true);
    expect(tools.find((t) => t.definition.name === 'get_weekly_stats')!.definition.mutatesContext).toBeUndefined();
  });

  it('log_water handler defaults cups to 1 and records it', async () => {
    const store = makeStore();
    const tools = createFitnessTools(store);
    const logWater = tools.find((t) => t.definition.name === 'log_water')!;

    const result = await logWater.handler('u1', {});

    expect(JSON.parse(result)).toMatchObject({ success: true });
    expect(store.hydrationLogs).toEqual([{ userId: 'u1', cups: 1 }]);
  });

  it('log_mood clamps ratings into the 1-5 range', async () => {
    const store = makeStore();
    const tools = createFitnessTools(store);
    const logMood = tools.find((t) => t.definition.name === 'log_mood')!;

    await logMood.handler('u1', { mood_rating: 9, energy_rating: -3, stress_level: 3 });

    expect(store.moodLogs[0]).toMatchObject({ moodRating: 5, energyRating: 1, stressLevel: 3 });
  });

  it('get_sleep_trend clamps days into the 1-30 range, defaulting to 7', async () => {
    const store = makeStore();
    let seenDays: number | null = null;
    store.getSleepTrend = async (_userId, days) => {
      seenDays = days;
      return [];
    };
    const tools = createFitnessTools(store);
    const getSleepTrend = tools.find((t) => t.definition.name === 'get_sleep_trend')!;

    await getSleepTrend.handler('u1', { days: 90 });
    expect(seenDays).toBe(30);

    await getSleepTrend.handler('u1', {});
    expect(seenDays).toBe(7);
  });

  it('get_weekly_stats returns the real response shape', async () => {
    const tools = createFitnessTools(makeStore());
    const getWeeklyStats = tools.find((t) => t.definition.name === 'get_weekly_stats')!;

    const result = JSON.parse(await getWeeklyStats.handler('u1', {}));

    expect(result).toMatchObject({
      workouts_this_week: 3,
      sleep: { avg_hours: 7.5 },
      mood: { avg_mood: 4 },
      calories_today: 1800,
    });
  });
});
