# AI Program Generation Improvements — Design

**Date:** 2026-04-14
**Status:** Approved design; awaiting implementation plan
**Author:** Darren Paul (with Claude Code)

## Problem

The current 4-agent AI program generation pipeline produces programs that need manual correction. Four specific complaints drive this work:

1. **Difficulty mismatch** — Beginners receive intermediate/advanced exercises despite questionnaire data indicating otherwise.
2. **Low exercise variety within programs** — Same 3–4 exercises appear across back-to-back days and subsequent weeks for the same client.
3. **Low exercise variety across clients** — Different clients with similar profiles receive near-identical programs. With 900+ exercises in the library, this is a striking under-utilization.
4. **Monotonous training methods** — Supersets dominate output; the other 10 available techniques (straight sets, circuits, rest-pause, EMOM, tri-sets, etc.) are rarely prescribed.

Net effect: the AI saves design/thinking time but loses some of that savings back to manual correction. The user wants to progress from "useful assist" to "reliable first draft" so trust can deepen over time.

## Root Causes (from codebase diagnostic)

| Issue                        | Root cause                                                                                                                                                                                                  | Location                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Beginners get hard exercises | `filterByDifficultyLevel` only excludes `advanced`, permits `intermediate`. No hard schema constraint. Agent 3 has discretion. Fallback defaults to `"beginner"` when profile is missing, but permissively. | `functions/src/ai/orchestrator.ts:312-327`; `functions/src/ai/exercise-context.ts` |
| Low within-program variety   | Dedup only checks within a program; compound slots have identical structure across weeks, so Agent 3 must find N variations from a small filtered list. Prompt allows reuse "when few options."             | `functions/src/ai/dedup-verify.ts`; `functions/src/ai/prompts.ts:330-344, 450`     |
| Low cross-client variety     | No tracking of exercises assigned across clients or across one client's program history. Semantic filter's top-ranked exercises are the same for everyone with similar profiles.                            | `functions/src/ai/exercise-filter.ts`                                              |
| Superset monotony            | Agent 1 does not output a technique constraint forward to Agent 2. Agent 2 has full discretion and treats supersets as default time-optimizer. Schema default is `straight_set` but easily overridden.      | `functions/src/ai/schemas.ts:80-92`; `functions/src/ai/prompts.ts:293-309`         |

## Design Decisions (approved via brainstorm)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                          | Rationale                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Difficulty: hard exclusion + earned progression.** Beginners start with beginner-only exercises. From week 3, low-score (≤4/10) intermediates become eligible. No advanced exercises ever for beginners. Intermediate clients: beginner + intermediate allowed; low-score advanced eligible week 3+. Advanced clients: no restrictions.                                                         | Matches how a coach actually thinks — start safe, earn complexity. Prevents "front squat in week 1 for a true beginner."                            |
| 2   | **Variety: within-program + cross-coach + per-client tracking.** Record every exercise assigned, tagged by coach_id + client_id. Semantic filter down-ranks exercises used by the same coach in the last 60 days AND by the same client in the last 90 days.                                                                                                                                      | Directly addresses "between different athletes, same exercises." Also ensures a client's month-2 program evolves from month-1.                      |
| 3   | **Technique selection: phase-based plan + coach policy override.** Agent 1 outputs an explicit `technique_plan` per week (e.g., "Weeks 1–2 straight sets; Week 3 introduce antagonist supersets on accessories; Week 4 rest-pause finisher"). Agent 2 must follow it (schema-enforced). Coaches can set a studio-wide policy (disallowed techniques, preferred techniques) that overrides the AI. | Matches real programming logic (phase-dependent methods, intentional variety). Coach policy prevents re-correcting the same thing every generation. |
| 4   | **Enforcement: full stack (prompt + schema + validation + data layer).** Prompts rewritten for clarity; Zod schemas reject violations with retry; new DB tables track usage; semantic filter reads history.                                                                                                                                                                                       | LLM drift is inevitable at prompt-only level. Schema and data layers provide durable guardrails.                                                    |

## Architecture

Same 4-agent pipeline in `functions/src/ai/`, reinforced at four layers:

1. **Prompt layer** — Agent 1 outputs explicit `technique_plan` and `difficulty_ceiling` per week. Agent 2 must follow them. Agent 3 uses hard difficulty rules.
2. **Schema layer** — Zod schemas reject outputs that violate difficulty or technique constraints. Agents retry on validation failure (max 2 retries, then escalate to a job warning so the admin sees what the AI tried to do wrong).
3. **Data layer** — Append-only `generated_exercise_usage` table records every exercise assigned in a successful program. `coach_ai_policy` table holds per-coach technique preferences and defaults.
4. **Selection layer** — `semanticFilterExercises` queries usage table and down-ranks recently-used exercises.

## Component Changes

| Area              | File                                                                               | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompts           | `functions/src/ai/prompts.ts`                                                      | Rewrite all three agent system messages: Agent 1 emits `technique_plan` and `difficulty_ceiling`; Agent 2 must honor them; Agent 3 hard-blocks exercises above the week's ceiling.                                                                                                                                                                                                                                                                                                                            |
| Schemas           | `functions/src/ai/schemas.ts`                                                      | Add `technique_plan` (array of `{week_number, allowed_techniques, default_technique, notes}`), `difficulty_ceiling` (per week: max `difficulty_score` and allowed `difficulty` tiers), and `progression_phase` to `sessionStructureSchema`. Slot `technique` must match that week's `allowed_techniques`. Exercise assignment must satisfy that week's `difficulty_ceiling`.                                                                                                                                  |
| Difficulty filter | `functions/src/ai/exercise-context.ts`                                             | `filterByDifficultyLevel` becomes a hard exclusion (no "intermediate leaks into beginner"). Add `filterByProgressionPhase(weekNumber, experienceLevel)` implementing the earned-progression rules.                                                                                                                                                                                                                                                                                                            |
| Semantic filter   | `functions/src/ai/exercise-filter.ts`                                              | Accept `usageHistory: { coachRecent: Map<exerciseId, lastUsedDaysAgo>, clientRecent: Map<exerciseId, lastUsedDaysAgo> }` parameter. Apply scoring penalties: coach-scope used within 60 days → −30; client-scope used within 90 days → −50. Add diversity boost: exercises with zero recent usage get +10. Return a diversified top-N (ensure no single movement pattern dominates).                                                                                                                          |
| DB migration      | `supabase/migrations/<timestamp>_exercise_usage_tracking.sql`                      | Create `generated_exercise_usage` (id uuid PK, coach_id uuid, client_id uuid, exercise_id uuid, program_id uuid, week_number int, day_number int, assigned_at timestamptz default now()) with indexes on `(coach_id, assigned_at desc)` and `(client_id, assigned_at desc)`. Create `coach_ai_policy` (coach_id uuid PK, disallowed_techniques jsonb default '[]', preferred_techniques jsonb default '[]', technique_progression_enabled bool default true, programming_notes text, updated_at timestamptz). |
| DAL               | `lib/db/exercise-usage.ts`, `lib/db/coach-ai-policy.ts`                            | Queries: `getCoachRecentUsage(coachId, daysBack)`, `getClientRecentUsage(clientId, daysBack)`, `recordProgramExerciseUsage(programId, rows)`. Coach policy: `getCoachPolicy`, `upsertCoachPolicy`. Must be importable from both Next.js (server client) and Firebase function (service-role client).                                                                                                                                                                                                          |
| Orchestrator      | `functions/src/ai/orchestrator.ts`                                                 | Before Agent 1: fetch coach policy + usage history. Inject policy into Agent 1 prompt as COACH INSTRUCTIONS augment. Pass usage history into semantic filter. After Validation success: record exercises to `generated_exercise_usage`.                                                                                                                                                                                                                                                                       |
| Admin UI          | `app/(admin)/admin/settings/ai-policy/page.tsx` (new) + supporting form components | Coach sets disallowed techniques (multi-select), preferred techniques (multi-select), programming notes (TipTap or textarea). Saves to `coach_ai_policy` table.                                                                                                                                                                                                                                                                                                                                               |
| Tests             | `__tests__/ai/*.test.ts` (new/extended) + Playwright e2e                           | Cover new filters, semantic filter with history, schema rejection + retry, two-client diversity, progression-by-week.                                                                                                                                                                                                                                                                                                                                                                                         |

## Data Flow (one generation)

```
Admin triggers generation (app/api/admin/programs/generate/route.ts)
  ↓
Firebase job handler (functions/src/program-generation.ts)
  ↓
orchestrator.ts:
  1. Fetch client profile
  2. Fetch coach_ai_policy
  3. Fetch exercise usage history (coach 60d, client 90d)
  ↓
Agent 1 (Profile Analyzer)
  Input: profile + coach policy + COACH INSTRUCTIONS (if any)
  Output: session_structure + technique_plan[] + difficulty_ceiling[] per week
  ↓
Difficulty filter (hard exclusion) + progression phase filter (per week)
  ↓
Semantic filter (scores exercises, applies usage penalties, returns diversified top N)
  ↓
Agent 2 (Program Architect)
  Input: Agent 1 output + coach policy
  Must follow technique_plan; schema rejects violations → retry (max 2)
  ↓
Agent 3 (Exercise Selector)
  Input: skeleton + filtered library + difficulty_ceiling
  Must stay within ceiling; schema rejects violations → retry (max 2)
  ↓
Validation Agent (existing, code-based)
  ↓
On success: INSERT rows into generated_exercise_usage (one row per exercise per slot per day per week)
  ↓
Return program to admin
```

## Error Handling

- **Schema validation failure** — Retry agent with validation error as user-message feedback (max 2 retries per agent). After 2, write a job warning surfacing the specific constraint violated so the admin sees what went wrong.
- **Library gap** — If, after difficulty + progression filtering, a slot has zero available exercises, job completes with warning: `Exercise library gap: no <difficulty> options for <movement_pattern>; used closest available.` Surfaces real gaps in the 900+ library for the user to fill.
- **Usage history query failure** — Log error; continue with empty history. Program generation is never blocked by tracking-layer failure.
- **Missing coach policy** — Use sensible system defaults: `default_technique: "straight_set"`, no restrictions, progression enabled.

## Testing Strategy

| Level            | Test                                                              | Asserts                                                                                        |
| ---------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Unit             | `filterByDifficultyLevel` — beginner, week 1                      | Zero intermediate exercises returned                                                           |
| Unit             | `filterByProgressionPhase` — beginner, week 3                     | Intermediates with `difficulty_score ≤ 4` included; advanced still excluded                    |
| Unit             | `semanticFilterExercises` with usage history                      | Recently-used exercises ranked lower; diversity boost applied                                  |
| Unit             | Schema: slot technique not in `allowed_techniques` for that week  | Validation fails; error message identifies the violation                                       |
| Unit             | Schema: exercise with `difficulty_score > ceiling`                | Validation fails                                                                               |
| Integration      | Generate two programs for distinct beginners under same coach     | ≥50% exercise difference                                                                       |
| Integration      | Generate 4-week program for beginner                              | Week 1: zero intermediates; week 3+: may contain low-score intermediates; no advanced any week |
| Integration      | With `coach_ai_policy.disallowed_techniques: ["circuit", "emom"]` | Generated program contains zero circuits or EMOMs                                              |
| Integration      | Generate program B for same client 30 days after program A        | Program B has ≥40% different exercises from A                                                  |
| E2E (Playwright) | Admin sets "no supersets" policy → generates program              | Zero supersets in output                                                                       |

## Parallel Execution Plan

**Wave 1 (4 independent agents, all parallel):**

- Agent A — Prompt rewrites in `prompts.ts` (all three agent system messages)
- Agent B — Schema updates in `schemas.ts` (technique_plan, difficulty_ceiling, progression_phase)
- Agent C — Difficulty filter in `exercise-context.ts` (hard exclusion + progression)
- Agent D — DB migrations in `supabase/migrations/` (two new tables + indexes)

**Wave 2 (3 agents, after Wave 1):**

- Agent E — DAL: `lib/db/exercise-usage.ts` + `lib/db/coach-ai-policy.ts` (depends on D)
- Agent F — Semantic filter in `exercise-filter.ts` (depends on A, C)
- Agent G — Orchestrator wiring in `orchestrator.ts` (depends on A, B, C, E)

**Wave 3 (2 agents, after Wave 2):**

- Agent H — Admin UI for coach AI policy (depends on E)
- Agent I — Tests (unit + integration + e2e; depends on everything else)

## Out of Scope

- Retraining/fine-tuning any model. We're working entirely with prompt, schema, filter, and data layers.
- Changing the Validation Agent (code-based) beyond what's required for the new schema fields.
- Migrating exercises in the library (no changes to the 900+ exercise records themselves).
- Exercise embedding model changes.
- Multi-tenant/franchise coach isolation beyond a single `coach_id` scope.

## Open Questions

None at design time. Questions that emerged during implementation should be surfaced to the user via the implementation plan.

## References

- Root diagnostic: see diagnostic report from exploration agent (2026-04-14).
- Project `CLAUDE.md` — architectural conventions.
- `functions/src/ai/` — existing AI pipeline code.
- `lib/db/` — DAL pattern to follow.
