# @aria/adapter-fitness

A standalone proof that `@aria/core`'s mechanism-in-core/content-in-adapter split (see `docs/superpowers/specs/2026-08-28-aria-adapter-fitness-design.md`) works for a real domain — the My Body fitness app. **This is not the real My Body app**: it uses mocked/injected context and an in-memory data store, not a real database. Wiring this into My Body's actual Supabase tables is a separate, later effort.

## Two limitations, stated deliberately

1. **Dated snapshot, not auto-synced.** The tools, guardrail categories, sentiment patterns, and memory extraction prompt in this package are a faithful port of real My Body source as of 2026-08-28. If the real app's `aria-tools.ts`, `aria-guardrails.ts`, `aria-sentiment.ts`, or `aria-memory.ts` change later, this package will silently drift out of sync — the same class of drift `ARIA-Reference.md` itself had to be corrected for once already.
2. **Hardcoded content, not dynamically configurable.** Guardrail categories, sentiment patterns, and the memory extraction prompt are all fixed at package-version time. Making these DB-driven or per-tenant configurable is out of scope for this phase — revisit only when a real consumer actually needs it.

## Manual live-memory smoke test

Automated tests use stub LLM providers and cannot prove the memory subsystem actually produces a usable memory against a real model. Before treating this phase as fully done, run:

```bash
ANTHROPIC_API_KEY=... npx tsx packages/adapter-fitness/scripts/live-memory-smoke-test.ts
```

This sends 12 messages through a real `buildFitnessChatEngine()` instance against a live Anthropic key, then waits a few seconds for the fire-and-forget summarization to complete. It does not automatically assert anything — it creates a second, separate `MemoryManager` instance that shares no state with the engine's internal one, so it can only confirm that summarization *can* produce a memory against a live model, not that this exact engine instance surfaced it. Verification is manual: check server logs or a debug breakpoint in `MemoryManager.saveMemory` to confirm a memory was actually written. See RISK-003 in `RISK-REGISTER.md` for the broader pattern-list-risk this and the guardrail/sentiment content share.
