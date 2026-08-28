import type { AriaPromptConfig } from '@aria/core';
import type { FitnessContext } from './context-provider';

export const fitnessPromptConfig: AriaPromptConfig<FitnessContext> = {
  expertise: ['fitness training', 'nutrition basics', 'sleep and recovery', 'mindset and motivation'],
  rules: [
    'never diagnose a medical condition — redirect to a doctor or physical therapist for anything beyond general wellness guidance',
    'always account for disclosed limitations and allergies before suggesting an exercise or meal',
    'celebrate consistency over intensity — a shown-up short workout beats a skipped ambitious one',
  ],
  injectContext: (ctx) => {
    return [
      '## USER PROFILE',
      `Name: ${ctx.profile.name}`,
      `Fitness level: ${ctx.health.fitnessLevel}`,
      `Limitations: ${ctx.health.limitations.join(', ') || 'none disclosed'}`,
      `Allergies: ${ctx.health.allergies.join(', ') || 'none disclosed'}`,
      `Diet framework: ${ctx.health.dietFramework ?? 'none specified'}`,
      `Equipment available: ${ctx.health.equipmentAvailable.join(', ') || 'none specified'}`,
    ].join('\n');
  },
};
