import type { SafetyCheckResult } from './types';

const CRISIS_PATTERNS: RegExp[] = [
  /\b(kill myself|suicid\w*|end my life|want to die|self[- ]harm|hurt(?:ing)? myself)\b/i,
  /\b(chest pain|can'?t breathe|cannot breathe|severe bleeding|heart attack|stroke)\b/i,
  /\b(overdose|poisoned|poisoning)\b/i,
];

const DEFAULT_SAFETY_RESPONSE =
  "I'm really glad you told me. What you're describing sounds like it needs immediate attention from a real person right now — please contact a medical professional, call your local emergency number, or reach out to a crisis line (in the US, call or text 988). I'm not able to help with this myself, but you deserve real support right now.";

export function checkSafety(
  message: string,
  response: string = DEFAULT_SAFETY_RESPONSE
): SafetyCheckResult {
  const matched = CRISIS_PATTERNS.some((pattern) => pattern.test(message));
  if (matched) {
    return { blocked: true, response };
  }
  return { blocked: false };
}
