// packages/adapter-fitness/src/index.ts
import {
  ChatEngine,
  InMemoryHistoryStore,
  RateLimiter,
  ToolRegistry,
  FallbackEngine,
} from '@aria/core';
import type { LLMProvider } from '@aria/core';
import { FitnessContextProvider } from './context-provider';
import type { FitnessContext } from './context-provider';
import { fitnessPromptConfig } from './prompt-config';
import { createFitnessTools, type FitnessDataStore } from './tools';
import { fitnessGuardrails } from './guardrails-config';
import { fitnessSentiment } from './sentiment-config';
import { createFitnessMemory } from './memory-config';
import { fitnessFallbackTopics, FITNESS_DEFAULT_FALLBACK } from './fallback-responses';

export { FitnessContextProvider } from './context-provider';
export type { FitnessContext } from './context-provider';
export { fitnessPromptConfig } from './prompt-config';
export { createFitnessTools } from './tools';
export type { FitnessDataStore } from './tools';
export { fitnessGuardrails } from './guardrails-config';
export { fitnessSentiment } from './sentiment-config';
export { createFitnessMemory } from './memory-config';
export { fitnessFallbackTopics, FITNESS_DEFAULT_FALLBACK } from './fallback-responses';

// A trivial in-memory FitnessDataStore for the standalone-proof deployment
// this package targets — see docs/superpowers/specs/2026-08-28-aria-adapter-fitness-design.md.
function createInMemoryDataStore(): FitnessDataStore {
  // Writes are captured here for inspection only — the read methods below (getWeeklyStats, etc.)
  // return fixed stub data and do not aggregate these logs. This store has no aggregation logic
  // by design (standalone proof, not a real backend).
  const hydration: { userId: string; cups: number }[] = [];
  const mood: { userId: string; moodRating: number; energyRating: number; stressLevel: number; note: string | null }[] = [];
  return {
    async logWater(userId, cups) {
      hydration.push({ userId, cups });
    },
    async logMood(userId, moodRating, energyRating, stressLevel, note) {
      mood.push({ userId, moodRating, energyRating, stressLevel, note });
    },
    async getWeeklyStats() {
      return { workoutsThisWeek: 0, avgSleepHours: null, avgMood: null, caloriesToday: 0 };
    },
    async getSleepTrend() {
      return [];
    },
    async getWorkoutHistory() {
      return [];
    },
    async getNutritionToday() {
      return { meals: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
    },
    async getMoodTrend() {
      return [];
    },
    async getPersonalRecords() {
      return [];
    },
  };
}

export function buildFitnessChatEngine(deps: {
  llmProvider: LLMProvider;
  summarizerProvider?: LLMProvider;
}): ChatEngine<FitnessContext> {
  const historyStore = new InMemoryHistoryStore();
  const toolRegistry = new ToolRegistry();
  for (const tool of createFitnessTools(createInMemoryDataStore())) {
    toolRegistry.register(tool);
  }

  return new ChatEngine({
    contextProvider: new FitnessContextProvider(),
    historyStore,
    promptConfig: fitnessPromptConfig,
    llmProvider: deps.llmProvider,
    toolRegistry,
    fallbackEngine: new FallbackEngine(fitnessFallbackTopics, FITNESS_DEFAULT_FALLBACK),
    rateLimiter: new RateLimiter(historyStore, { freeLimit: 20 }),
    guardrails: fitnessGuardrails,
    sentiment: fitnessSentiment,
    memory: createFitnessMemory(historyStore, deps.summarizerProvider ?? deps.llmProvider),
  });
}
