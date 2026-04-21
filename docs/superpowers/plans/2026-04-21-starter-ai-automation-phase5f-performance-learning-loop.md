# Starter AI Automation — Phase 5f: Performance Learning Loop (Plan)

**Spec:** [2026-04-21-starter-ai-automation-phase5f-performance-learning-loop-design.md](../specs/2026-04-21-starter-ai-automation-phase5f-performance-learning-loop-design.md)

## Steps

1. `supabase/migrations/00091_prompt_templates_few_shot.sql` — `ALTER TABLE ADD COLUMN few_shot_examples jsonb NOT NULL DEFAULT '[]'`.
2. `types/database.ts` — add `PromptFewShotExample`; extend `PromptTemplate.category` / `scope` union to match current DB constraint; add `few_shot_examples` field.
3. `functions/src/performance-learning-loop.ts` (NEW) — `runPerformanceLearningLoop()` pure helper.
4. `functions/src/index.ts` — register `performanceLearningLoop` on `"0 3 * * 1"` America/Chicago.
5. `functions/src/__tests__/performance-learning-loop.test.ts` — unit tests with stub Supabase.
6. Apply migration via Supabase MCP.
7. Verification gate: tsc (Next + functions), new tests green.

## Out of scope

- Fanout integration (future follow-up).
- Admin UI for examples.
- Blog / newsletter learning.
