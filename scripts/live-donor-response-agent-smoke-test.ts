// packages/adapter-corpflow/scripts/live-donor-response-agent-smoke-test.ts
// Manual smoke test — requires ANTHROPIC_API_KEY or OPENROUTER_API_KEY in the environment.
// Run with: npx tsx packages/adapter-corpflow/scripts/live-donor-response-agent-smoke-test.ts
//
// PRIMARY PURPOSE: send the Donor Response Agent's real prompts to a live
// model and verify two things that genuinely depend on what an
// unpredictable real model actually does — no stub or unit test can
// substitute for this:
//   (a) for a first-time donor (priorGiftCount: 0), does the live model
//       actually honor "do not reference any giving history" — i.e. does
//       its prose never slip in "again", "another", or a specific prior
//       gift count, despite not being told one exists;
//   (b) for a repeat donor (priorGiftCount: 3), does the live model
//       reference returning/continued support in a plausible, warm way
//       WITHOUT fabricating specifics (a specific dollar total, a specific
//       date, or a prior-gift count other than the one it was actually
//       given) — the system prompt explicitly forbids inventing facts, and
//       only a real model's output can show whether it complies;
//   (c) does the model's raw response — in both cases — survive
//       stripMarkdownFence + JSON.parse cleanly (the same class of
//       live-model surprise that broke MemoryManager.maybeSummarize()
//       against a live model; see packages/core/src/memory-manager.ts's
//       stripMarkdownFence, and packages/adapter-corpflow/scripts/
//       live-tenant-scoping-smoke-test.ts's identical concern).
// This is the test's real, reportable signal, and the one this script's
// exit code is primarily about.
//
// WHY THIS SCRIPT DOESN'T IMPORT `donorResponseAgentDefinition` DIRECTLY:
// The real agent definition lives in CorpFlow's own app repo, at
// src/lib/agents/donor-response.ts (currently the `aria-agents` worktree at
// /Users/mrdrdaddy/.config/superpowers/worktrees/corpflow/aria-agents) — a
// separate git repository from this one, not a workspace package this repo
// can depend on. That module also does top-level imports of CorpFlow's own
// `@/lib/db` (a live Drizzle connection) and `@/lib/email/resend` (a live
// Resend client), and resolves the `@/...` alias via CorpFlow's own
// tsconfig — none of which this script, run standalone from the ARIA repo
// via `npx tsx`, can or should pull in for what is purely a prompt/parse
// smoke test.
//
// Instead, `buildDonorResponsePrompt` and `parseDonorResponseOutput` below
// are a deliberate, faithful, line-for-line mirror of `buildPrompt` and
// `parseOutput` from that file (as of the commit this script was added in).
// They are NOT re-exported/shared code — if the real donor-response.ts
// prompt or parser ever changes, this mirror must be updated by hand to
// match, or this script silently stops testing the actual behavior. This is
// the same kind of documented, deliberate deviation from a literal-reading
// of the task brief that this task's own dispatch note called out
// elsewhere (see task-15-report.md) — not an oversight.

import { stripMarkdownFence, AnthropicProvider, OpenRouterProvider } from '@aria/core';
import type { AgentDraftOutput, LLMProvider } from '@aria/core';

interface DonorResponseInput {
  donorFirstName: string;
  donorEmail: string;
  amount: string;
  designation: string | null;
  priorGiftCount: number;
  tenantName: string;
}

// Mirrors donor-response.ts's ordinalSuffix() exactly.
function ordinalSuffix(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'st';
  if (n % 10 === 2 && n % 100 !== 12) return 'nd';
  if (n % 10 === 3 && n % 100 !== 13) return 'rd';
  return 'th';
}

// Mirrors donor-response.ts's buildPrompt() exactly.
function buildDonorResponsePrompt(input: DonorResponseInput): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    `You are drafting a short, warm, personal follow-up email on behalf of ${input.tenantName}, a nonprofit organization, to one of its donors.`,
    'This is IN ADDITION TO an automated receipt the donor already sees elsewhere — do not write a receipt or restate payment/transaction details as your primary content; write a genuine, brief thank-you.',
    'Never state a number of prior gifts, a total giving amount, or any fact not explicitly given to you below — if you don\'t have a fact, don\'t reference it.',
    'Respond with only JSON, no markdown code fences, no explanation before or after it.',
    'JSON shape: { "draftContent": string, "sourceSnapshot": { "amount": string, "designation": string | null, "priorGiftCount": number } }',
  ].join('\n');

  const historyLine =
    input.priorGiftCount > 0
      ? `This is their ${input.priorGiftCount + 1}${ordinalSuffix(input.priorGiftCount + 1)} gift, following ${input.priorGiftCount} prior gift${input.priorGiftCount === 1 ? '' : 's'} to this organization — you may warmly acknowledge their continued support, but do not invent specific past amounts or dates.`
      : 'This is their first gift to this organization — welcome them, do not reference any giving history.';

  const userPrompt = [
    `Donor first name: ${input.donorFirstName}`,
    `Gift amount: ${input.amount}`,
    `Designation/campaign: ${input.designation ?? 'General fund'}`,
    historyLine,
  ].join('\n');

  return { systemPrompt, userPrompt };
}

// Mirrors donor-response.ts's parseOutput() exactly.
function parseDonorResponseOutput(raw: string): AgentDraftOutput {
  const cleaned = stripMarkdownFence(raw);
  const parsed = JSON.parse(cleaned) as { draftContent: string; sourceSnapshot: Record<string, unknown> };
  return { draftContent: parsed.draftContent, sourceSnapshot: parsed.sourceSnapshot };
}

function buildProvider(): LLMProvider {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;

  if (anthropicKey) {
    if (openRouterKey) {
      console.log('Both ANTHROPIC_API_KEY and OPENROUTER_API_KEY are set — defaulting to AnthropicProvider.');
    }
    return new AnthropicProvider({ apiKey: anthropicKey });
  }
  if (openRouterKey) {
    return new OpenRouterProvider({ apiKey: openRouterKey });
  }
  console.error('Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY to run this script.');
  process.exit(1);
}

const FIRST_TIME_DONOR: DonorResponseInput = {
  donorFirstName: 'Priya',
  donorEmail: 'priya@example.com',
  amount: '$75',
  designation: 'General fund',
  priorGiftCount: 0,
  tenantName: 'Riverbend Community Foundation',
};

const REPEAT_DONOR: DonorResponseInput = {
  donorFirstName: 'Marcus',
  donorEmail: 'marcus@example.com',
  amount: '$250',
  designation: 'Winter Shelter Campaign',
  priorGiftCount: 3,
  tenantName: 'Riverbend Community Foundation',
};

// Words/phrases that would indicate the model is referencing giving history
// it was explicitly told does not exist for a first-time donor.
const HISTORY_LEAKAGE_PATTERNS = [/\bagain\b/i, /\banother\b/i, /\bonce more\b/i, /\breturning\b/i, /\brepeat\b/i];

// A crude but useful fabrication check for the repeat donor: the prompt
// gives no specific dollar total or date, so a response containing a
// dollar amount other than the current gift's amount is a plausible sign
// of fabricated specifics. Not exhaustive — a real human review of the
// draftContent text is still the actual signal; this is a tripwire only.
function containsUnexpectedDollarAmount(text: string, expectedAmount: string): boolean {
  const amounts = text.match(/\$[\d,]+(?:\.\d{2})?/g) ?? [];
  return amounts.some((a) => a !== expectedAmount);
}

async function runCase(
  provider: LLMProvider,
  label: string,
  input: DonorResponseInput
): Promise<{ label: string; passed: boolean; draft?: AgentDraftOutput; notes: string[] }> {
  const notes: string[] = [];
  let passed = true;

  const { systemPrompt, userPrompt } = buildDonorResponsePrompt(input);
  const response = await provider.call({
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  let draft: AgentDraftOutput;
  try {
    draft = parseDonorResponseOutput(response.content);
  } catch (err) {
    notes.push(`FAIL: response did not survive parseOutput cleanly: ${(err as Error).message}. Raw: ${response.content.slice(0, 300)}`);
    return { label, passed: false, notes };
  }
  notes.push(`draftContent: ${draft.draftContent}`);

  if (input.priorGiftCount === 0) {
    const leaked = HISTORY_LEAKAGE_PATTERNS.filter((re) => re.test(draft.draftContent));
    if (leaked.length > 0) {
      notes.push(`FAIL: first-time donor response references giving history it wasn't given (matched: ${leaked.map((r) => r.source).join(', ')})`);
      passed = false;
    }
  } else {
    const mentionsContinuedSupport = /\bcontinu|\bsupport|\bgenerous|\bonce again|\bstill\b/i.test(draft.draftContent);
    if (!mentionsContinuedSupport) {
      notes.push('WARN: repeat-donor response does not clearly acknowledge returning support (not necessarily a failure — a human should read the draft)');
    }
    if (containsUnexpectedDollarAmount(draft.draftContent, input.amount)) {
      notes.push(`FAIL: repeat-donor response contains a dollar amount other than the actual gift amount (${input.amount}) — likely fabricated specifics`);
      passed = false;
    }
  }

  return { label, passed, draft, notes };
}

async function main() {
  const provider = buildProvider();
  let anyFailure = false;

  for (const { label, input } of [
    { label: 'first-time donor (priorGiftCount: 0)', input: FIRST_TIME_DONOR },
    { label: 'repeat donor (priorGiftCount: 3)', input: REPEAT_DONOR },
  ]) {
    console.log(`\nCase: ${label}`);
    const result = await runCase(provider, label, input);
    for (const note of result.notes) console.log(`  ${note}`);
    console.log(`  Result: ${result.passed ? 'PASS' : 'FAIL'}`);
    if (!result.passed) anyFailure = true;
  }

  console.log(`\n${anyFailure ? 'FAILURES FOUND' : 'ALL CASES PASSED'}`);
  if (anyFailure) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
