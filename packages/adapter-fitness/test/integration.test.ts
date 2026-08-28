// packages/adapter-fitness/test/integration.test.ts
import { describe, it, expect } from 'vitest';
import type { LLMProvider } from '@aria/core';
import { buildFitnessChatEngine } from '../src/index';

describe('adapter-fitness end-to-end', () => {
  it('exercises tools, guardrails, sentiment, and memory through a full sendMessage call', async () => {
    let callCount = 0;
    const llmProvider: LLMProvider = {
      async call() {
        callCount++;
        if (callCount === 1) {
          return { content: '', toolCalls: [{ name: 'log_water', arguments: { cups: 2 } }] };
        }
        return { content: 'Logged your water, nice work!' };
      },
    };

    const engine = buildFitnessChatEngine({ llmProvider });
    const result = await engine.sendMessage('demo_user', 'I just drank 2 cups of water, feeling great!', 'free');

    expect(result.ariaMessage.content).toBe('Logged your water, nice work!');
    expect(callCount).toBe(2);
  });

  it('redirects an off-topic message using the real guardrail categories', async () => {
    let called = false;
    const llmProvider: LLMProvider = {
      async call() {
        called = true;
        return { content: 'should not be reached' };
      },
    };
    const engine = buildFitnessChatEngine({ llmProvider });

    const result = await engine.sendMessage('demo_user', 'should I invest in the stock market this year', 'free');

    expect(called).toBe(false);
    expect(result.ariaMessage.content).toContain('wellness');
  });

  it('respects the crisis safety filter identically to any other domain', async () => {
    let called = false;
    const llmProvider: LLMProvider = {
      async call() {
        called = true;
        return { content: 'should not be reached' };
      },
    };
    const engine = buildFitnessChatEngine({ llmProvider });

    const result = await engine.sendMessage('demo_user', 'I want to end my life', 'free');

    expect(called).toBe(false);
    expect(result.ariaMessage.content).toContain('988');
  });
});
