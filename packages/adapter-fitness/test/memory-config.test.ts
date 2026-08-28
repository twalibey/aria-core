import { describe, it, expect } from 'vitest';
import { InMemoryHistoryStore } from '@aria/core';
import type { LLMProvider } from '@aria/core';
import { createFitnessMemory } from '../src/memory-config';

describe('createFitnessMemory', () => {
  it('summarizes a conversation using the real extraction prompt shape and later recalls it', async () => {
    const historyStore = new InMemoryHistoryStore();
    for (let i = 0; i < 10; i++) {
      await historyStore.saveMessage('u1', { role: 'user', content: `message ${i}` });
    }
    let seenSystemPrompt = '';
    const summarizerProvider: LLMProvider = {
      async call(params) {
        seenSystemPrompt = params.systemPrompt;
        return {
          content: JSON.stringify([
            { type: 'concern', content: 'Right knee pain that flares up during running' },
          ]),
        };
      },
    };
    const memory = createFitnessMemory(historyStore, summarizerProvider);

    await memory.maybeSummarize('u1');

    expect(seenSystemPrompt).toContain('ARIA');
    expect(seenSystemPrompt).toContain('goal');
    expect(seenSystemPrompt).toContain('concern');

    const section = await memory.buildMemoryPromptSection('u1');
    expect(section).toContain('Right knee pain that flares up during running');
  });

  it('does not re-summarize before the message threshold is met again', async () => {
    const historyStore = new InMemoryHistoryStore();
    for (let i = 0; i < 10; i++) {
      await historyStore.saveMessage('u1', { role: 'user', content: `message ${i}` });
    }
    let callCount = 0;
    const summarizerProvider: LLMProvider = {
      async call() {
        callCount++;
        return { content: JSON.stringify([{ type: 'goal', content: 'Training for a 10k' }]) };
      },
    };
    const memory = createFitnessMemory(historyStore, summarizerProvider);

    await memory.maybeSummarize('u1');
    await memory.maybeSummarize('u1'); // no new messages since — should bail

    expect(callCount).toBe(1);
  });
});
