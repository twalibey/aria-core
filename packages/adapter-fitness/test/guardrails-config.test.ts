import { describe, it, expect } from 'vitest';
import { fitnessGuardrails } from '../src/guardrails-config';

// Copied verbatim from the private REDIRECT_MESSAGES map in guardrails-config.ts
// so the it.each below can assert the specific expected message per category,
// not just truthiness.
const EXPECTED_REDIRECTS: Record<string, string> = {
  finance:
    "I'm flattered you'd ask, but financial advice is outside my expertise! I'm all about wellness - fitness, nutrition, sleep, and mindset. What can I help you with on that front?",
  programming:
    "Ha, I wish I could help with code, but my superpowers are in wellness, not software! If you have questions about training, nutrition, or recovery, I'm your person.",
  politics:
    "I stay in my lane on that one! I'm here for your physical and mental wellness. Want to talk about something fitness or health related instead?",
  creative_writing:
    "I'm more of a wellness coach than a writer! But I can definitely help you journal about your fitness journey, set goals, or reflect on your progress. Interested?",
  academics:
    "Math isn't my forte - but I can calculate your macros, estimate your TDEE, or help you figure out progressive overload numbers! Want to try that instead?",
  legal:
    "Legal questions are way outside my lane. I'd recommend talking to a qualified attorney. But if you have any wellness questions, I'm here for you!",
};

describe('fitnessGuardrails', () => {
  it('allows a wellness message even if it also mentions an off-topic keyword', () => {
    const result = fitnessGuardrails.check('how does stress affect my workout performance');
    expect(result.allowed).toBe(true);
  });

  it.each([
    ['should I invest in the stock market or crypto', 'finance'],
    ['can you write me some python code', 'programming'],
    ['what do you think about the election this year', 'politics'],
    ['I need legal advice from a lawyer about a lawsuit', 'legal'],
    ['help me solve this calculus homework problem', 'academics'],
    ['write me a story about a dragon', 'creative_writing'],
  ])('blocks an off-topic %s message with the correct category redirect', (message, category) => {
    const result = fitnessGuardrails.check(message);
    expect(result.allowed).toBe(false);
    expect(result.redirectMessage).toBe(EXPECTED_REDIRECTS[category]);
  });

  it('allows an on-topic fitness message through', () => {
    const result = fitnessGuardrails.check('what should my macros look like on a cutting phase');
    expect(result.allowed).toBe(true);
  });

  it('always allows short messages regardless of content', () => {
    expect(fitnessGuardrails.check('lawyer').allowed).toBe(true);
  });
});
