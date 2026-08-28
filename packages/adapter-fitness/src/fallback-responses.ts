// packages/adapter-fitness/src/fallback-responses.ts
import type { FallbackTopic } from '@aria/core';

export const fitnessFallbackTopics: FallbackTopic[] = [
  { match: /workout|exercise|training/i, response: "Let's talk training! What are you working on this week?" },
  { match: /sleep|tired|rest/i, response: "Sleep and recovery matter as much as the workout itself. How's your sleep been lately?" },
  { match: /nutrition|food|eat|diet/i, response: "Nutrition is a big piece of the puzzle. What's on your plate lately?" },
];

export const FITNESS_DEFAULT_FALLBACK =
  "I'm having trouble connecting right now, but I'm still here for your fitness, nutrition, sleep, and mindset questions.";
