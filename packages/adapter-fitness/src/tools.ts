import type { Tool } from '@aria/core';

/**
 * Stands in for the real Supabase tables (hydration_logs, mood_logs,
 * workout_logs, sleep_logs, nutrition_logs, personal_records) — this
 * package has no real database, per the "standalone proof" scope decision.
 */
export interface FitnessDataStore {
  logWater(userId: string, cups: number): Promise<void>;
  logMood(userId: string, moodRating: number, energyRating: number, stressLevel: number, note: string | null): Promise<void>;
  getWeeklyStats(userId: string): Promise<{ workoutsThisWeek: number; avgSleepHours: number | null; avgMood: number | null; caloriesToday: number }>;
  getSleepTrend(userId: string, days: number): Promise<{ date: string; hours: number; quality: number }[]>;
  getWorkoutHistory(userId: string, days: number): Promise<{ title: string; durationMinutes: number; rpe: number; date: string }[]>;
  getNutritionToday(userId: string): Promise<{ meals: { food: string; type: string; calories: number; protein: number; carbs: number; fat: number }[]; totals: { calories: number; protein: number; carbs: number; fat: number } }>;
  getMoodTrend(userId: string, days: number): Promise<{ date: string; mood: number; energy: number; stress: number }[]>;
  getPersonalRecords(userId: string, exerciseName?: string): Promise<{ exercise: string; type: string; value: number; unit: string; date: string }[]>;
}

function clampDays(days: unknown): number {
  return Math.min(30, Math.max(1, Number(days) || 7));
}

function clampRating(value: unknown): number {
  return Math.min(5, Math.max(1, Number(value)));
}

export function createFitnessTools(store: FitnessDataStore): Tool<any>[] {
  return [
    {
      definition: {
        name: 'log_water',
        description: 'Log water intake for the user. Use when the user says they drank water or asks you to track hydration.',
        parameters: {
          type: 'object',
          properties: { cups: { type: 'number', description: 'Number of cups (8oz each)' } },
        },
        mutatesContext: true,
      },
      handler: async (userId: string, args: { cups?: number }) => {
        const cups = Number(args.cups) || 1;
        await store.logWater(userId, cups);
        return JSON.stringify({ success: true, message: `Logged ${cups} cup${cups !== 1 ? 's' : ''} of water.` });
      },
    },
    {
      definition: {
        name: 'log_mood',
        description: "Log the user's current mood, energy, and stress levels based on what they share in conversation.",
        parameters: {
          type: 'object',
          properties: {
            mood_rating: { type: 'number', description: 'Mood 1-5 (1=very low, 5=great)' },
            energy_rating: { type: 'number', description: 'Energy 1-5 (1=exhausted, 5=energized)' },
            stress_level: { type: 'number', description: 'Stress 1-5 (1=calm, 5=very stressed)' },
            note: { type: 'string', description: 'Brief note about context' },
          },
          required: ['mood_rating', 'energy_rating', 'stress_level'],
        },
        mutatesContext: true,
      },
      handler: async (
        userId: string,
        args: { mood_rating: number; energy_rating: number; stress_level: number; note?: string }
      ) => {
        const moodRating = clampRating(args.mood_rating);
        const energyRating = clampRating(args.energy_rating);
        const stressLevel = clampRating(args.stress_level);
        await store.logMood(userId, moodRating, energyRating, stressLevel, args.note ?? null);
        return JSON.stringify({
          success: true,
          message: `Mood logged: mood ${moodRating}/5, energy ${energyRating}/5, stress ${stressLevel}/5.`,
        });
      },
    },
    {
      definition: {
        name: 'get_weekly_stats',
        description: "Get the user's wellness stats for the current week - workouts, average sleep, average mood, and calories today.",
        parameters: { type: 'object', properties: {} },
      },
      handler: async (userId: string) => {
        const stats = await store.getWeeklyStats(userId);
        return JSON.stringify({
          workouts_this_week: stats.workoutsThisWeek,
          sleep: { avg_hours: stats.avgSleepHours },
          mood: { avg_mood: stats.avgMood },
          calories_today: stats.caloriesToday,
        });
      },
    },
    {
      definition: {
        name: 'get_sleep_trend',
        description: "Get the user's sleep data for the past N days. Use when they ask about sleep quality, patterns, or trends.",
        parameters: {
          type: 'object',
          properties: { days: { type: 'number', description: 'Number of days to look back (default 7, max 30)' } },
        },
      },
      handler: async (userId: string, args: { days?: number }) => {
        const days = clampDays(args.days);
        const entries = await store.getSleepTrend(userId, days);
        return JSON.stringify({ days_requested: days, entries });
      },
    },
    {
      definition: {
        name: 'get_workout_history',
        description: "Get the user's recent workout history. Use when they ask about past workouts or training frequency.",
        parameters: {
          type: 'object',
          properties: { days: { type: 'number', description: 'Number of days to look back (default 7, max 30)' } },
        },
      },
      handler: async (userId: string, args: { days?: number }) => {
        const days = clampDays(args.days);
        const workouts = await store.getWorkoutHistory(userId, days);
        return JSON.stringify({ days_requested: days, workouts });
      },
    },
    {
      definition: {
        name: 'get_nutrition_today',
        description: "Get what the user has eaten today. Use when they ask about their meals or daily nutrition.",
        parameters: { type: 'object', properties: {} },
      },
      handler: async (userId: string) => JSON.stringify(await store.getNutritionToday(userId)),
    },
    {
      definition: {
        name: 'get_mood_trend',
        description: "Get the user's mood and energy trends for the past N days.",
        parameters: {
          type: 'object',
          properties: { days: { type: 'number', description: 'Number of days to look back (default 7, max 30)' } },
        },
      },
      handler: async (userId: string, args: { days?: number }) => {
        const days = clampDays(args.days);
        const entries = await store.getMoodTrend(userId, days);
        return JSON.stringify({ days_requested: days, entries });
      },
    },
    {
      definition: {
        name: 'get_personal_records',
        description: "Get the user's personal records (PRs). Use when they ask about their best lifts, fastest times, etc.",
        parameters: {
          type: 'object',
          properties: { exercise_name: { type: 'string', description: 'Optional: filter by exercise name' } },
        },
      },
      handler: async (userId: string, args: { exercise_name?: string }) => {
        const records = await store.getPersonalRecords(userId, args.exercise_name);
        return JSON.stringify({ records });
      },
    },
  ];
}
