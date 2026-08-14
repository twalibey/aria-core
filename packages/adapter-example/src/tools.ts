import type { Tool } from '@aria/core';

export const checkInTool: Tool<{ habitName: string }> = {
  definition: {
    name: 'check_in_habit',
    description: 'Record that the user completed a habit today',
    parameters: {
      type: 'object',
      properties: { habitName: { type: 'string' } },
      required: ['habitName'],
      additionalProperties: false,
    },
  },
  handler: async (userId, args) => `Checked in "${args.habitName}" for ${userId}`,
};
