import { GuardrailFilter } from '@aria/core';

const REDIRECT_MESSAGES: Record<string, string> = {
  finance:
    "I'm flattered you'd ask, but financial advice is outside my expertise! I'm all about wellness - fitness, nutrition, sleep, and mindset. What can I help you with on that front?",
  programming:
    "Ha, I wish I could help with code, but my superpowers are in wellness, not software! If you have questions about training, nutrition, or recovery, I'm your person.",
  politics:
    "I stay in my lane on that one! I'm here for your physical and mental wellness. Want to talk about something fitness or health related instead?",
  harmful:
    "That's not something I can help with. I'm here to support your wellness journey - fitness, nutrition, sleep, and mindset. What would you like to work on?",
  creative_writing:
    "I'm more of a wellness coach than a writer! But I can definitely help you journal about your fitness journey, set goals, or reflect on your progress. Interested?",
  academics:
    "Math isn't my forte - but I can calculate your macros, estimate your TDEE, or help you figure out progressive overload numbers! Want to try that instead?",
  legal:
    "Legal questions are way outside my lane. I'd recommend talking to a qualified attorney. But if you have any wellness questions, I'm here for you!",
};

export const fitnessGuardrails = new GuardrailFilter({
  categories: [
    {
      key: 'finance',
      pattern: /\b(stock market|invest(?:ing|ment)|crypto(?:currency)?|bitcoin|ethereum|trading|portfolio|401k|ira|dividend)\b/i,
      redirectMessage: REDIRECT_MESSAGES.finance,
    },
    {
      key: 'programming',
      pattern: /\b(write (?:me )?(?:a |some )?code|debug|javascript|python|typescript|sql query|html|css|programming|compile|deploy|github|git commit)\b/i,
      redirectMessage: REDIRECT_MESSAGES.programming,
    },
    {
      key: 'politics',
      pattern: /\b(politic(?:s|al)|election|democrat|republican|trump|biden|congress|senate|liberal|conservative|left wing|right wing)\b/i,
      redirectMessage: REDIRECT_MESSAGES.politics,
    },
    {
      key: 'harmful',
      pattern: /\b(bomb|weapon|hack(?:ing)?|exploit|malware|phishing|attack|how to hurt|how to harm)\b/i,
      redirectMessage: REDIRECT_MESSAGES.harmful,
    },
    {
      key: 'creative_writing',
      pattern: /\b(write me a (?:story|poem|essay|song|novel|script|book)|creative writing|fiction)\b/i,
      redirectMessage: REDIRECT_MESSAGES.creative_writing,
    },
    {
      key: 'academics',
      pattern: /\b(math (?:problem|equation|homework)|calculus|algebra|geometry|trigonometry|solve for x)\b/i,
      redirectMessage: REDIRECT_MESSAGES.academics,
    },
    {
      key: 'legal',
      pattern: /\b(legal advice|lawyer|sue|lawsuit|court case|attorney)\b/i,
      redirectMessage: REDIRECT_MESSAGES.legal,
    },
  ],
  overridePattern:
    /\b(workout|exercise|training|nutrition|diet|meal|sleep|rest|recovery|stretch|yoga|muscle|cardio|protein|calories|hydrat|wellness|fitness|health|body|weight|fat|lean|soreness|pain|injury|stress|anxiety|mood|energy|mindset|breathe|breathing|meditation)\b/i,
  defaultRedirectMessage:
    "That's a bit outside my wheelhouse! I'm best at helping with fitness, nutrition, sleep, recovery, and mindset. What wellness topic can I help with?",
});
