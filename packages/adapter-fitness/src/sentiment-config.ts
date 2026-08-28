import { SentimentDetector } from '@aria/core';
import type { SentimentHint } from '@aria/core';

function buildFitnessSentimentSection(sentiment: SentimentHint): string {
  const lines: string[] = [
    '\n## CURRENT MESSAGE CONTEXT',
    `The user's message suggests: ${sentiment.mood} mood, ${sentiment.energy} energy, intent: ${sentiment.intent}.`,
  ];

  if (sentiment.mood === 'distressed') {
    lines.push(
      'IMPORTANT: The user may be in distress. Be extra gentle, validate their feelings, and suggest professional support if appropriate. Do NOT jump to workout suggestions.'
    );
  } else if (sentiment.mood === 'negative') {
    lines.push('Be empathetic and validating before offering advice. Acknowledge what they are feeling first.');
  }

  if (sentiment.intent === 'celebration') {
    lines.push('Match their excitement! Celebrate with them. This is their moment.');
  } else if (sentiment.intent === 'venting') {
    lines.push("Listen first. Don't jump to solutions unless asked. Validate their experience.");
  }

  if (sentiment.energy === 'low') {
    lines.push("Keep suggestions low-effort and manageable. Don't overwhelm with big plans.");
  }

  return lines.join('\n');
}

export const fitnessSentiment = new SentimentDetector({
  distressPattern:
    /\b(can't take|give up|hopeless|hate my|what's the point|worthless|breaking down|falling apart|don't see the point|want to quit|so done)\b/i,
  negativePattern:
    /\b(frustrated|angry|sad|tired|exhausted|stressed|anxious|worried|struggling|failed|sucks|horrible|terrible|ugh|can't|won't|disappointed|upset|overwhelmed|hurting|miserable|depressed|annoyed|irritated)\b/gi,
  positivePattern:
    /\b(great|awesome|amazing|excited|proud|happy|love|nailed|crushed it|personal best|pb|pr|finally|yes!|let's go|fantastic|incredible|pumped|stoked|grateful|thankful|blessed)\b/gi,
  highEnergyPattern: /!{2,}|\b(let's go|pumped|fired up|ready|bring it|crush|hyped|amped|stoked)\b/i,
  lowEnergyPattern: /\b(tired|exhausted|drained|low energy|sluggish|meh|whatever|idk|blah|can't be bothered|don't feel like)\b/i,
  requestKeywordPattern: /\b(help|show|give|log|set|create|make|find|track|record|add|start)\b/i,
  buildPromptSection: buildFitnessSentimentSection,
});
