// Regression harness for the safety-filter pattern set.
//
// Every phrasing the filter is expected to block gets a case here, as does
// every benign decoy we have deliberately scoped a pattern around. Adding a
// pattern to safety-filter.ts means adding rows to BOTH tables below.
import { describe, it, expect } from 'vitest';
import { checkSafety } from '../src/safety-filter';

const BLOCKED: [label: string, message: string][] = [
  // --- Crisis: inflected / colloquial suicidal-ideation phrasings ---
  ['take my life', 'I keep thinking I might take my life'],
  ['take my own life', "I've thought about taking my own life"],
  ['take my own life (bare)', 'I want to take my own life'],
  ["don't want to live anymore", "I don't want to live anymore"],
  ['dont want to live anymore (no apostrophe)', 'I dont want to live anymore'],
  ["don't want to be alive anymore", "I don't want to be alive anymore"],
  ['better off dead', 'Everyone would be better off dead without me'],
  ['no reason to live', 'There is no reason to live'],
  ['cutting myself', "I've been cutting myself again"],
  ['cut myself', 'I cut myself last night'],

  // --- Medical: inflected forms of the original patterns ---
  ['chest pain (singular)', 'I have chest pain and I feel dizzy'],
  ['chest pains (plural)', 'I have chest pains that keep coming back'],
  ['heart attack (singular)', 'I think I am having a heart attack'],
  ['heart attacks (plural)', 'I keep getting what feel like heart attacks'],

  // --- Medical: newly covered acute phrasings ---
  ['trouble breathing', 'I am having trouble breathing'],
  ['difficulty breathing', 'I have difficulty breathing when I lie down'],
  ['short of breath', 'I am really short of breath right now'],
  ['shortness of breath', 'I have sudden shortness of breath'],
  ['took too many pills', 'I took too many pills earlier'],
  ['seizure', 'I just had a seizure'],
  ['seizures (plural)', 'I have been having seizures'],
  ['throat closing', 'My throat closing feeling is getting worse'],
  ["throat's closing", "My throat's closing up"],
  ['throat is closing', 'My throat is closing'],
  ['bleeding badly', 'I am bleeding badly from my arm'],
];

// Benign phrasings that must NOT trip the filter. These are the guardrails on
// how broadly the patterns above are allowed to match.
const ALLOWED: [label: string, message: string][] = [
  ['fitness question', 'What should I eat before a workout?'],
  ['chest workout', 'My chest workout left me sore'],
  ['cut myself some slack idiom', 'I need to cut myself some slack about my progress'],
  ['cut myself a break idiom', 'I should cut myself a break this week'],
  ['film cuts to black', 'The film cuts to black at the end'],
  ['take my life seriously', 'I take my life seriously and want to get healthier'],
  ['take my life in a new direction', 'I want to take my life in a new direction'],
  ['take my life back', 'I want to take my life back after this injury'],
  ['generic protein question', 'How much protein should I eat per day?'],
  ['sore legs', 'My legs are sore after leg day'],
  ['deadlift PR', 'I hit a new deadlift PR today'],
];

describe('safety-filter pattern coverage', () => {
  it.each(BLOCKED)('blocks %s', (_label, message) => {
    const result = checkSafety(message);
    expect(result.blocked).toBe(true);
    expect(result.response).toBeTruthy();
  });

  it.each(ALLOWED)('does not block %s', (_label, message) => {
    expect(checkSafety(message).blocked).toBe(false);
  });

  it('inspects the user message only — the crisisResponse argument is never scanned', () => {
    // Passing crisis-shaped text as the second argument must not itself
    // trigger a block; it is the reply to return, not text to inspect.
    const result = checkSafety('How much water should I drink?', 'I want to end my life');
    expect(result.blocked).toBe(false);
  });
});
