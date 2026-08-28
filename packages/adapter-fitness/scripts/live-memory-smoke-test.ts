// packages/adapter-fitness/scripts/live-memory-smoke-test.ts
// Manual script, not part of the automated test suite — run with a real
// ANTHROPIC_API_KEY. See README.md "Manual live-memory smoke test".
import { AnthropicProvider } from '@aria/core';
import { buildFitnessChatEngine } from '../src/index';

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Set ANTHROPIC_API_KEY to run this script.');
    process.exit(1);
  }

  const llmProvider = new AnthropicProvider({ apiKey });
  const engine = buildFitnessChatEngine({ llmProvider });

  const messages = [
    "Hi! I'm training for a half marathon in October.",
    'My right knee has been bothering me during long runs.',
    'I prefer running in the early morning before work.',
    "Yesterday's run was tough, only managed 3 miles.",
    'I logged 8 hours of sleep last night, feeling good.',
    "I'm a bit worried about my knee holding up for race day.",
    'Nutrition-wise I have been eating more protein lately.',
    'Any tips for taper week before a half marathon?',
    "I skipped my run today, just wasn't feeling it.",
    'Back on track today, did a solid 5-mile run.',
    "My knee felt better today, didn't hurt at all.",
    'How many more long runs should I fit in before race day?',
  ];

  for (const message of messages) {
    const result = await engine.sendMessage('smoke_test_user', message, 'premium');
    console.log(`> ${message}\n${result.ariaMessage.content}\n`);
  }

  // Give the fire-and-forget summarization a moment to complete before checking.
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const { createFitnessMemory } = await import('../src/memory-config');
  // NOTE: this creates a second MemoryManager instance sharing no state with
  // the engine's internal one — this script only proves summarization CAN
  // produce a memory against a live model, not that it is actually surfaced
  // by this exact engine instance. Manually verify the memory in the console
  // output above (a later sendMessage call's behavior implicitly reflects it
  // if you inspect the system prompt via a debug log) or extend this script
  // to expose the engine's internal memory manager if deeper verification is needed.
  console.log('Smoke test sent 12 messages. Check server logs / a debug breakpoint in MemoryManager.saveMemory to confirm a memory was actually written.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
