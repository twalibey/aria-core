import type { SafetyCheckResult } from './types.js';

// Suicidal-ideation / self-harm phrasings. `\w*` suffixes are deliberate: they
// pick up inflected forms ("suicidal", "self-harming") without needing an
// alternative per tense.
const CRISIS_PATTERNS: RegExp[] = [
  /\b(kill(?:ing)? myself|suicid\w*|end(?:ing)? my life|want to die|self[- ]harm\w*|hurt(?:ing)? myself)\b/i,
  // "take my life" is excluded when followed by the common benign idioms
  // ("take my life seriously" / "back" / "in a new direction").
  /\b(tak\w* my (?:own )?life(?!\s+(?:seriously|back|in a\b))|don'?t want to (?:live|be alive) anymore|better off dead|no reason to live)\b/i,
  // "cut myself" is excluded when followed by the "some slack" / "a break"
  // idioms, which are far more common than the self-harm reading.
  /\b(cut(?:t?ing)? myself(?!\s+(?:some\s+)?(?:slack|a break)))\b/i,
  // Acute medical-symptom phrasings.
  /\b(chest pain\w*|can'?t breathe|cannot breathe|severe bleeding|bleeding badly|heart attack\w*|stroke)\b/i,
  /\b(trouble breathing|difficulty breathing|short(?:ness)? of breath|took too many pills|seizure\w*|throat(?:'?s| is)? closing)\b/i,
  /\b(overdos\w*|poisoned|poisoning)\b/i,
];

const DEFAULT_SAFETY_RESPONSE =
  "I'm really glad you told me. What you're describing sounds like it needs immediate attention from a real person right now — please contact a medical professional, call your local emergency number, or reach out to a crisis line (in the US, call or text 988). I'm not able to help with this myself, but you deserve real support right now.";

/**
 * Inspects the USER's message only — never any assistant/model output. There is
 * no output-side filtering in this package. The second parameter is the crisis
 * reply to return when a pattern matches, NOT text to also be scanned.
 *
 * English keyword/regex matching with known false negatives (see RISK-002).
 */
export function checkSafety(
  message: string,
  crisisResponse: string = DEFAULT_SAFETY_RESPONSE
): SafetyCheckResult {
  const matched = CRISIS_PATTERNS.some((pattern) => pattern.test(message));
  if (matched) {
    return { blocked: true, response: crisisResponse };
  }
  return { blocked: false };
}
