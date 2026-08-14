import { describe, it, expect } from 'vitest';
import { checkInTool } from '../src/tools';

describe('checkInTool', () => {
  it('records a habit check-in for the given user', async () => {
    const result = await checkInTool.handler('demo_user', { habitName: 'Morning walk' });
    expect(result).toBe('Checked in "Morning walk" for demo_user');
  });
});
