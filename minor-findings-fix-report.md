# Minor Findings Fix Report

Batch of 5 small, independent fixes for previously-parked code review findings.

## Item 1: Memory read-side failure shouldn't sink the whole response to the fallback engine

- `packages/core/src/chat-engine.ts:174-180` — wrapped the
  `this.deps.memory.buildMemoryPromptSection(userId)` call in its own
  try/catch inside `generateResponse()`. On failure it now reports via
  `this.reportError(userId, 'llm', err)` and continues (does not rethrow),
  so the system prompt simply loses the memory section instead of the whole
  response falling back to `FallbackEngine`.
- `packages/core/test/chat-engine.test.ts` — added a new test in the
  existing `describe('ChatEngine.sendMessage — memory', ...)` block:
  `'does not fall back to the fallback engine when the memory read side throws'`.
  It stubs `buildMemoryPromptSection` to throw and asserts
  `result.ariaMessage.content` is the real LLM response (`'Hi Sam!'`), not a
  fallback-engine response. Reused the existing `MemoryManager` import from
  `'../src/memory-manager'`.

Did not touch `packages/core/src/memory-manager.ts` or
`packages/core/test/memory-manager.test.ts`, per instructions.

## Item 2: Document the magic `1000` cap in both in-memory memory stores

- `packages/adapter-fitness/src/memory-config.ts:28-33` — added the
  specified comment directly above
  `const messages = await this.historyStore.getRecentMessages(userId, 1000);`
  in `countMessagesSince`.
- `packages/adapter-example/src/memory-config.ts:10-15` — same comment added
  above the equivalent line.

## Item 3: `FitnessContextProvider` hands out a shared object reference

- `packages/adapter-fitness/src/context-provider.ts:47-56` — `buildContext`
  now returns a clone: `profile` is shallow-spread, `health` is
  shallow-spread with `limitations`, `allergies`, and `equipmentAvailable`
  arrays individually copied (field names matched the existing
  `FitnessContext` interface exactly, no adjustment needed). Every call now
  returns a fresh object instead of the shared `MOCK_USERS[userId]` /
  `DEFAULT_CONTEXT` reference.

## Item 4: Misleadingly-named sentiment test

- `packages/adapter-fitness/test/sentiment-config.test.ts:30` — renamed
  `'returns an empty prompt section for neutral sentiment'` to
  `'does not include the distress warning when sentiment is neutral'`.
  Assertion body unchanged (`.not.toContain('IMPORTANT')`).

## Item 5: Name the `harmful` guardrail category's bypass risk explicitly in RISK-003

- `RISK-REGISTER.md` — appended one sentence to RISK-003's Description
  paragraph naming the concrete wellness-keyword-override bypass example
  (a message like "how do I hack my body" bypassing the harmful category via
  the override, checked before off-topic categories), noting this is
  faithful to the ported precedence order and that `checkSafety` remains the
  safety-critical layer.

## Test / Typecheck Output

`npm test` (from repo root):

```
 Test Files  26 passed (26)
      Tests  176 passed (176)
```

All tests pass, including the new chat-engine memory-read-failure test.

`npm run typecheck` (from repo root):

```
 Test Files  26 passed (26)
      Tests  137 passed (137)
Type Errors  no errors
```

Clean — no type errors.

## Files Changed

- `packages/core/src/chat-engine.ts`
- `packages/core/test/chat-engine.test.ts`
- `packages/adapter-fitness/src/memory-config.ts`
- `packages/adapter-example/src/memory-config.ts`
- `packages/adapter-fitness/src/context-provider.ts`
- `packages/adapter-fitness/test/sentiment-config.test.ts`
- `RISK-REGISTER.md`
