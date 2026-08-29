# MemoryManager markdown-fence bug fix — report

## Bug

`MemoryManager.maybeSummarize()` called `JSON.parse(response.content)` directly on the
summarizer LLM's raw response. Real models routinely wrap JSON responses in a markdown
code fence (` ```json\n...\n``` `) even when told not to, so `JSON.parse` threw on every
real-model call. The error was caught and routed to `onError`, so it failed silently
from the caller's perspective — memory summarization never actually persisted anything
against a real model.

## Fix

Added a module-level (non-exported) helper in `packages/core/src/memory-manager.ts`:

```ts
const MARKDOWN_FENCE_RE = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(MARKDOWN_FENCE_RE);
  return match ? match[1].trim() : trimmed;
}
```

Wired into `maybeSummarize()`:

```ts
const extracted = JSON.parse(stripMarkdownFence(response.content)) as {
  type: string;
  content: string;
}[];
```

Trims the input; if it's a whole-string triple-backtick fence (optional `json` tag),
returns the trimmed inner content; otherwise returns the trimmed input unchanged
(no fence → today's exact behavior, just trimmed).

## TDD evidence

**RED** — before the fix, with tests updated:
- Ran `npx vitest run packages/core/test/memory-manager.test.ts` from the workspace root.
- New test `strips a markdown code fence around the LLM response before parsing` **failed**:
  `expected [] to have a length of 1 but got +0` — proves the bug (fenced JSON never gets
  parsed/saved) existed before the fix.
- All 10 other tests passed, including the corrected `routes a JSON.parse failure to
  onError and saves nothing` test (fixture changed to `'{"type": "goal", "content":
  "unterminated'`, a genuinely truncated/invalid JSON string) — confirming that test's
  fixture fix doesn't itself depend on the fence-stripping fix.

**GREEN** — after implementing `stripMarkdownFence` and wiring it in:
- `npx vitest run packages/core/test/memory-manager.test.ts` → **11/11 passed**.

## Files changed

- `packages/core/src/memory-manager.ts` — added `stripMarkdownFence` helper, applied it
  in `maybeSummarize()` before `JSON.parse`.
- `packages/core/test/memory-manager.test.ts`:
  - Fixed the `routes a JSON.parse failure to onError and saves nothing` test's fixture:
    was `'```json\n[{"type": "goal", "content": "malformed"}]\n```'` (valid JSON once
    fence-stripped — testing the wrong thing), changed to
    `'{"type": "goal", "content": "unterminated'` (genuinely invalid JSON, unaffected by
    the fence fix). Test name/assertions unchanged.
  - Added new test `strips a markdown code fence around the LLM response before parsing`
    in the `MemoryManager.maybeSummarize` describe block, using the file's existing
    `seedMessages`/`makeMemoryStore` helpers.

## Test output

`npx vitest run packages/core/test/memory-manager.test.ts` (post-fix):
```
Test Files  1 passed (1)
     Tests  11 passed (11)
```

`npx vitest run packages/core` (full core suite):
```
Test Files  14 passed (14)
     Tests  134 passed (134)
```

`npm test` (workspace: `pretest` build of `@aria/core` + `vitest run`, full workspace):
```
Test Files  26 passed (26)
     Tests  175 passed (175)
```

`npm run typecheck` (workspace: build + `tsc -b --noEmit` + `vitest --typecheck.only`):
```
Test Files  26 passed (26)
     Tests  136 passed (136)
Type Errors  no errors
```

## Self-review findings

- `stripMarkdownFence` is module-level and not exported, matching the spec — it's an
  internal parsing detail, not part of `MemoryManager`'s public surface.
- The regex is anchored (`^...$`) against the *trimmed* string, so it only strips a fence
  that wraps the *entire* response. A response with prose before/after the fence (e.g.
  "Here's the JSON:\n```json\n...\n```") would not be stripped and would still fail to
  parse. This matches the exact behavior specified in the task; broadening it (e.g. to
  extract a fenced block embedded in surrounding prose) was out of scope and not
  requested.
- No fence present → behavior is unchanged except the input is now `.trim()`ed before
  `JSON.parse`, which is strictly more permissive (trailing/leading whitespace was
  already legal JSON whitespace, so this can't newly break any previously-passing input).
- Ran the full core suite and the full workspace suite (via the `pretest`/`build` +
  `vitest run` pipeline) and the typecheck pipeline; all green, no regressions elsewhere
  in the workspace.

## Concerns

None. The fix is narrowly scoped to the reported bug, matches the spec's exact regex,
and both the fixed pre-existing test and the new test pass, alongside the full test and
typecheck suites.
