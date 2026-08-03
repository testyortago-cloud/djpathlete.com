# AI Program Generator — Instruction-Aware Retrieval & Exercise Variety

**Date:** 2026-08-03
**Status:** Approved (architecture section signed off; remaining sections authored under autonomous mode)

## Problem

Two distinct defects, stacked, both invisible from the UI.

### 1. The candidate library is silently gutted before the model sees it

Evidence — two production runs three minutes apart, near-identical instructions:

| | Run A `6c2e127c` (16:38) | Run B `ed7bdb23` (16:41) |
|---|---|---|
| unique exercises | 51 | 59 |
| shared | 40 (**68% overlap**) | |

The instruction read:

> "Focus on progressive overload with compound movements (**squat, bench press, deadlift, overhead press, barbell row**). Prioritize strength rep ranges (3-6 main lifts, 8-12 accessories)."

Both programs came back **100% bodyweight**. Zero of the five named lifts appeared. Not one barbell.

Root cause — the named lifts were deleted before the Exercise Selector ran:

| Filter | Trigger | Survivors of 922 |
|---|---|---|
| `filterByAvailableEquipment` | no client profile → `availableEquipment` falls back to `[]` (`orchestrator.ts:441`). An empty list keeps only `is_bodyweight` items | 408 |
| `filterByDifficultyLevel` | no profile → `clientDifficultyLevel` defaults to `"beginner"` (`orchestrator.ts:420`) | 229 |

`Back Squat` is `barbell` + `intermediate`. `Bench Press` is `barbell, bench` + `intermediate`. `Deadlift` is `barbell` + `intermediate`. Each is cut twice over.

Coach instructions *are* injected into all three agent prompts under a "HIGHEST PRIORITY — overrides ALL default rules" banner (`shared-helpers.ts:76`), but a prompt has no power over a list that was already filtered.

### 2. What survives is ranked identically every run

- `semanticFilterExercises` assigns every exercise a flat base score of `50` (`exercise-filter.ts:500`). The `match_exercises` RPC returns `(id, similarity)` — the similarity is fetched from Postgres and **discarded** at `exercise-filter.ts:452`.
- With a constant base score, `sort` is stable, so ordering collapses to the raw DB order from `getExercisesForAI()`, which has no `ORDER BY`.
- `formatExerciseLibrary` dumps that order into the prompt verbatim; the model's position bias does the rest.
- **`diversifyByMMR` has never run.** Both call sites (`exercise-filter.ts:394`, `:541`) pass `k = filtered.length`, and the function opens with `if (scored.length <= k) return scored.map(...)`. It returns its input unchanged. Unit tests pass because they call the helper directly with `k=3` against 4 items (`__tests__/exercise-filter.test.ts:144`) — a test that cannot fail at the call site.
- `orchestrator.ts` never passes `mmrLambda` at all; only `week-orchestrator.ts:902` does.

Not a cause: temperature is never set anywhere in `callAgent`, so it is the API default of 1.0. Sampling is not the bottleneck — the candidate set is.

## Decisions (from brainstorming)

1. **Instructions win outright.** Naming a lift or equipment unlocks it. Injury filters stay absolute.
2. **Meaningfully different each run.** Regenerating with identical inputs should yield a genuinely different program.
3. **Override the guess, respect the measurement.** The `"beginner"` default and the `[]` equipment fallback are guesses — instructions beat them. A ceiling from an actual movement assessment (`assessmentContext.maxDifficultyScore`) is measured evidence and stays absolute; named lifts above it are skipped with a note.
4. **Haiku extraction pass** for turning free text into structured overrides, with a narrow deterministic fallback. Chosen over pure keyword matching because only it distinguishes *unlock barbell* from *ban barbell* — and getting that backwards is worse than today's behaviour.

## Architecture

```
additional_instructions + coach policy
   │
   ├─▶ extractInstructionIntent()         [NEW — Haiku, ~2s, graceful]
   │      { required_equipment, excluded_equipment,
   │        named_exercises, excluded_exercises }
   │
   └─▶ resolveIntentToExerciseIds()       [NEW — pure, no I/O]
          { unlockedIds, bannedIds, matched[], unmatched[] }
                     │
                     ▼
  effectiveEquipment = availableEquipment ∪ required_equipment
  filterByAvailableEquipment(…, unlockedIds)   ← bypassable
  filterByDifficultyLevel(…, unlockedIds)      ← bypassable
  filterByDifficultyScore(assessment)          ← ABSOLUTE
  filterByInjuredJoints                        ← ABSOLUTE
  excludeIds ∪= bannedIds
                     │
                     ▼
  semanticFilterExercises
     · real similarity from match_exercises     [FIXED]
     · seeded tie-break jitter                  [NEW]
     · MMR before truncation                    [FIXED — was a no-op]
                     │
                     ▼
              Exercise Selector
```

### Why the unlock set must also reach the validators

This is the failure mode already learned once on the strict Exercise Pool: input filters that admit an exercise while the validator still rejects it produce **unfixable retry churn** — three attempts, identical output, identical rejection.

Two validators can veto an unlocked exercise:

| Validator | Severity | Action |
|---|---|---|
| `validateProgram` → `equipment_violation` (`validate.ts:210`) | **error** | widen `validatorEquipment` to include `required_equipment` **and** the equipment of every unlocked exercise |
| `validateAssignmentAgainstCeiling` (`schemas.ts:222`) | **error** | accept `unlockedIds` and skip those assignments |
| `validateProgram` → `difficulty_mismatch` (`validate.ts:275`) | warning only | no change needed |
| `validateProgram` → `difficulty_score_violation` (`validate.ts:284`) | error, assessment-gated | **no change** — this is the measured ceiling and stays absolute |

`validateAssignmentAgainstCeiling` is the dangerous one: Agent 1 derives `difficulty_ceiling` from the profile, so with no profile it emits a beginner ceiling and would reject every unlocked intermediate lift on every retry.

## Components

### `functions/src/ai/instruction-intent.ts` (new)

```ts
export interface InstructionIntent {
  required_equipment: string[]   // normalized slugs the coach explicitly wants
  excluded_equipment: string[]
  named_exercises: string[]      // literal names/phrases the coach named
  excluded_exercises: string[]
}

export interface IntentResolution {
  unlockedIds: Set<string>
  bannedIds: Set<string>
  matched: Array<{ phrase: string; exercise_ids: string[] }>
  unmatched: string[]            // named but no library match — surfaced to the coach
}

export const EMPTY_INTENT: InstructionIntent

export async function extractInstructionIntent(
  instructions: string | undefined,
  opts?: { signal?: AbortSignal },
): Promise<InstructionIntent>

export function resolveIntentToExerciseIds(
  intent: InstructionIntent,
  exercises: CompressedExercise[],
): IntentResolution

export function fallbackIntent(instructions: string): InstructionIntent
```

**Extraction.** Empty/absent instructions return `EMPTY_INTENT` with no AI call. Otherwise one `callAgent` against `MODEL_HAIKU` with a Zod schema, given the `CANONICAL_EQUIPMENT` vocabulary so it emits normalized slugs. Equipment strings are passed through `normalizeEquipment()` regardless, so a stray "dumbbells" still lands on `dumbbell`.

**Fallback.** If the Haiku call throws, `fallbackIntent` runs a deterministic scan for canonical equipment terms — but **only if the text contains no negation token** (`no `, `not `, `avoid`, `without`, `exclude`, `never`, `minimi`, `skip`, `don't`, `dont`). If negation is present it returns `EMPTY_INTENT`, degrading to current behaviour rather than guessing polarity backwards. Never blocks generation.

**Resolution (pure).** Name matching normalizes both sides: lowercase, strip the library's `_Muscle` suffix convention (`Push up_Chest` → `push up`), collapse punctuation/whitespace. A phrase matches an exercise when every significant token (length ≥ 3, minus stopwords) appears in the exercise's normalized name. So `"bench press"` unlocks `Bench Press`, `Dumbbell Barrel bench press_chest`, and `Iso bench press_chest` — which is the intent: the coach asked for bench pressing, not one specific row.

`required_equipment` is **not** resolved to IDs. It widens the available-equipment set instead, which composes correctly with the existing filter and validator rather than duplicating their logic.

**Ban beats unlock.** An id in both sets resolves to banned.

### Filter changes — `functions/src/ai/exercise-context.ts`

```ts
filterByAvailableEquipment(exercises, availableEquipment, unlockedIds?: Set<string>)
filterByDifficultyLevel(exercises, clientDifficulty, unlockedIds?: Set<string>)
```

Both gain a trailing optional parameter; an exercise in `unlockedIds` short-circuits to kept. Optional ⇒ every existing caller and test is unaffected.

`filterByProgressionPhase` also gains the parameter — it runs per-week inside the orchestrator loop and would otherwise re-prune unlocked exercises out of weeks 1–2.

### Ranking changes — `functions/src/ai/exercise-filter.ts`

1. **Keep the similarity.** `matchedIds: Set<string>` becomes `matchScores: Map<string, number>` holding the max similarity across slot groups. Base score becomes `similarity * 100` instead of the flat `50`.
2. **Seeded jitter.** `FilterOptions.seed?: string`. A deterministic `mulberry32(hashString(seed + exercise.id))` produces a per-(run, exercise) offset in `±JITTER_RANGE` (8 points). Large enough to reshuffle near-ties, small enough not to override real relevance gaps. Seed = the `ai_generation_log` row id, which is already unique per run and already persisted — so any run stays reproducible after the fact.
3. **MMR before truncation.** The bug is `k === input length`. Corrected shape:
   ```ts
   if (filtered.length > maxExercises) {
     filtered = useMMR
       ? diversifyByMMR(scoredAll, maxExercises, lambda)   // selects WHICH survive
       : filtered.slice(0, maxExercises)
   }
   ```
   MMR now chooses which `maxExercises` survive rather than reordering an already-truncated list.
4. **`orchestrator.ts` passes `mmrLambda: 0.7`**, matching `week-orchestrator.ts`.

### Stable base ordering — `functions/src/ai/program-chat-tools.ts`

`getExercisesForAI()` gains `.order("id")` so DB order stops being undefined and seeded jitter is the only source of run-to-run variation.

It also gains keyset pagination. The current `.limit(1000)` sits against 922 active exercises — 92% of the cap. At 1000 rows exercises begin silently vanishing from AI generation, which is the same class of defect this spec exists to fix. Paginating now costs ~10 lines.

### Observability

- `console.log` the resolved intent per run: unlocked count, banned count, unmatched phrases.
- Persist to `ai_generation_log.output_summary.instruction_intent`.
- Push `unmatched` phrases into `validation.issues` as warnings, so "you asked for barbell row — no library match" is visible on the program instead of silent.
- Unlocked exercises dropped by the **assessment** filter are reported separately: "requested but exceeds this client's assessed ceiling".

## Error handling

| Case | Behaviour |
|---|---|
| Haiku extraction throws | deterministic fallback; if negation present, `EMPTY_INTENT`. Never blocks generation. |
| Named exercise matches nothing | recorded in `unmatched`, surfaced as a validation warning |
| Named exercise blocked by assessment ceiling | skipped, reported distinctly from `unmatched` |
| Named exercise blocked by injury filter | skipped — injury filter is absolute, unchanged |
| Both named and excluded | banned wins |
| No instructions at all | zero AI calls, zero behaviour change |

## Testing

`functions/src/ai/__tests__/instruction-intent.test.ts` (new) — resolution is pure, so fixtures are real instruction texts from `ai_generation_log`:

- the five-lift text → unlocks `Back Squat`, `Bench Press`, `Deadlift…`, `Trap Bar Deadlift`
- `"NO barbell back squats"` → **banned, not unlocked** (the case keyword matching gets backwards)
- `"Minimize bilateral pressing"` → no spurious unlock
- unmatched phrase reporting
- ban beats unlock
- `fallbackIntent` returns `EMPTY_INTENT` when negation tokens are present

`__tests__/exercise-filter.test.ts` (extended):

- **MMR call-site test** — >`maxExercises` candidates through `scoreAndFilterExercises`/`semanticFilterExercises`, asserting the output differs from pure score order. This is the test that would have caught the no-op; the existing helper-level test cannot.
- seeded jitter: same seed → byte-identical order; different seed → different order
- similarity is used: mocked RPC returning distinct similarities → output ordering follows them, not DB order

`__tests__/exercise-context.test.ts`:

- `filterByAvailableEquipment([], unlockedIds)` → unlocked barbell exercise survives
- `filterByDifficultyLevel("beginner", unlockedIds)` → unlocked intermediate exercise survives
- `filterByDifficultyScore` is **not** bypassed by `unlockedIds`
- `filterByProgressionPhase` honours `unlockedIds` in weeks 1–2

Regression (the actual bug): no profile + the five-lift instruction → `Back Squat` present in the final filtered library, and `validateAssignmentAgainstCeiling` does not flag it.

## Out of scope

- Changing `temperature` — untouched at the API default.
- The Excel program-import path — separate pipeline.
- Any UI work. Unmatched-phrase warnings ride the existing validation-issues surface.
- Raising `getMaxExercises`' 200-exercise cap. With the filters fixed the shortlist is already far wider in practice; changing the cap too is an unnecessary variable in the same change.
