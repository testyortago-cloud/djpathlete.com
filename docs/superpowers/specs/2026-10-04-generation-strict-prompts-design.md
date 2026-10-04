# Strict, non-hallucinating program generation — design

Date: 2026-10-04. Status: approved in conversation ("lgtm"), awaiting written-spec review.
Source review: `docs/superpowers/reports/2026-10-04-program-generation-prompt-review.md` (finding numbers
below refer to it).

## Goal

Generate Week and Generate Day invent nothing: no sport, number, exercise name or muscle that the inputs
do not support. Every rule a model is given is one it has the data for, that no other rule contradicts,
and that code checks afterwards.

**Done means**, on a before/after replay of the five real requests (`scripts/replay-week-generation.ts`):
zero notes naming a sport other than the athlete's, zero notes stating sets/reps/rest/RPE/%, zero
model-written exercise names reaching notes, every poor substitute listed to the coach, and instruction
misses and cost no worse than before.

## Owner decisions (2026-10-04)

1. **Rotate main lifts weekly** — keep today's behaviour. It matches the owner's own programs: in live data,
   coach-made weeks share 13% of exercises with the previous week on average and 61% of week pairs share none.
   The prompts stop contradicting it.
2. **Poor fits: fill and flag.** A poor substitute stays, and is listed with its reason. It never triggers a rebuild.
3. **Notes are cues only.** Prescription numbers live in their fields; code removes note sentences that state them.

## Evidence from live data (read-only, 2026-10-04)

- Usage is Week/Day: ~990 AI rows into 29 programs in September; no full program AI-generated since June (8 ever).
- Rows with `slot_role` set are AI-written (only the generator writes it; `lib/db/program-exercises.ts:44`).
- Sport leaks: "tennis" in 19 AI notes of programs with no client and no "tennis" in the name; "golf" in 8 notes
  for a tennis client.
- Notes restate and contradict prescriptions: "6 each side" on reps "6"; "2 sets of 4; rest 90 seconds" in notes.
- `exercises.primary_muscles`: 18 values cover ~98% of uses; the tail has duplicates ("serratus anterior" /
  "serratus_anterior").
- Profiles: 51 total, 38 with sport (spellings include "Tennis ", "Tenis", "Pickle"), 7 with injury_details,
  46 with movement_confidence. `assessment_results` has 0 rows — assessment work is out of scope.
- Coaches use `intensity_pct` on 80 manual rows; the generator always saves it as null.

## Scope

**In (phase 1):** Week/Day path, plus the shared pieces both paths use (selector prompt, assignment schema,
`buildExerciseRows`), so full programs get those fixes for free. One full-program fix (technique repair).

**Phase 2 (kept only if replays show no regression):** rewrite the week/day architect and selector prompts into
the strict template and give exercises short aliases instead of UUIDs.

**Out:** porting the enricher / named-exercise note / pool plan / instruction check to full programs (unused
since June — revisit when full generation is used again); assessment handling; per-block main-lift continuity.

## Design — phase 1

### 1. The model gets the data its rules need (findings 1, 2, 18, 24)

- **One profile builder.** Extract the full-program profile JSON (`orchestrator.ts:385-411`) into
  `buildProfileContext(profile, opts)` in `shared-helpers.ts`. Week/Day use it for the architect, so they gain
  sport, age, gender, movement_confidence, training_years, occupation, likes, dislikes, background, notes and
  time_efficiency_preference. The `ignore_profile` and no-profile messages stay as today.
- **Sport normalisation.** `normalizeSport(raw)`: trim, lowercase, small alias map (`tenis→tennis`,
  `pickle→pickleball`). Empty → null.
- **Athlete block for the selector.** `buildAthleteContext(profile)` returns
  `{ sport, experience_level, movement_confidence, injury_details, exercise_dislikes }`, added to the selector's
  `Constraints` JSON in both orchestrators (`week-orchestrator.ts:1449`, `orchestrator.ts:738`). When sport is
  null the block carries `"sport": null` and the prompt says: "sport is null: do not mention any sport".
- **One client-difficulty default, Week/Day only.** `resolveClientDifficulty(profile, ignoreProfile)` replaces the
  conflicting fallbacks in the Week/Day path (`week-orchestrator.ts:1125`, `:1451`). Value: profile level, else
  `"advanced"` under ignore_profile (coach-directed), else `"intermediate"`. **Full programs
  (`orchestrator.ts`) deliberately keep their pre-2026-10-04 defaults** (owner decision, 2026-10-04: full generation
  is unmeasured on the current model): `profile?.experience_level ?? (ignore_profile ? "elite" : "beginner")` for
  the exercise filter, `?? "beginner"` for the selector constraints and the per-week sync level. A test pins this.
- **Program arc carries load.** `buildWeekFocusSummary` adds `total_sets` and `avg_rpe` per week, so a past deload
  is visible to the architect.

### 2. Notes are cues only (findings 3, 4, 5)

- **Prompt.** Selector rule 16 becomes: notes give technique and intent cues only; never state sets, reps, rest,
  RPE, percentages or loads; mention a sport only if it equals the athlete's sport. Remove the sport-specific and
  numeric examples (`prompts.ts:345, 536, 551-556`) and replace them with neutral cue examples.
- **`per_side`.** The assignment schema gains `per_side: boolean` (default false). When true and the slot's reps
  lack side wording, `buildExerciseRows` appends " each side" to reps. This is where unilateral counts go now.
- **Code guard at save.** A new `cleanNote(note, { athleteSport })` in `shared-helpers.ts`, run inside
  `sanitizeSlotRefsInNotes` before slot-ref replacement, drops whole sentences that:
  - state a prescription: `N sets`, `N reps`/`repetitions`, `N x N`, `rest … N`, `N%`, `RPE N`,
    `N each|per side|leg|arm`;
  - name a sport from a fixed list (tennis, pickleball, padel, golf, soccer, football, basketball, lacrosse,
    baseball, softball, cricket, volleyball, hockey, rugby, swimming) that is not the athlete's sport, with
    "tennis ball" exempt.
  Tempo wording ("lower over 3 seconds") is allowed. Dropped sentences are logged through a new
  `onCleanedNote` callback (console only). They do not join the coach-facing "the AI explained its own
  constraints" warning, which is about pipeline internals, not prescription repeats.
- **Names from the library.** `buildExerciseRows` takes a `nameById` map from the library and uses it for
  `nameBySlotId`. A model name that differs from the library name is logged, never used.

### 3. Fit is reported and checked (finding 6)

- The assignment schema gains `fit: "exact" | "close" | "poor"` (default "close") and `fit_reason: string | null`.
- **Code does not trust the label.** `gradeFits(weeks, assignments, library)`: if the exercise's
  `movement_pattern` is not compatible with the slot's (after the existing pattern remap), the fit is "poor";
  otherwise the model's label stands. Compatible groups: squat≈lunge, isometric≈rotation≈carry,
  locomotion≈conditioning. Warm-up, cool-down, power, conditioning and activation slots skip the pattern
  test (jumps, throws and drills legitimately cross patterns) but still honour a model "poor".
- **Shown, never rebuilt.** Poor fits become `result.slot_fit: Array<{ day_of_week, slot_role, exercise_name,
  slot_pattern, reason }>` on the week result. `components/admin/GenerationWarnings.tsx` gains a
  `SlotFitPanel` ("Substitutes the AI had to make"), rendered directly under "Your instructions, checked" in
  the generation dialog and the jobs dock, including when the coach gave no instructions. They do not change
  `instruction_check.status`, and `generateWithCompliance` ignores them.
- The selector prompt's "NEVER leave a slot without an assignment" stays; it now adds: "when nothing in the
  library fits, pick the closest and mark it poor with a one-line reason a coach can read".

### 4. Muscle names come from a closed list (finding 7)

- `muscleVocabulary(library)`: distinct `primary_muscles`, normalised (lowercase, spaces → underscores), keeping
  values with ≥ 3 uses. Today that is the 18 main muscles.
- The architect prompt (week/day and full) gets the list: "target_muscles must be values from this list".
- `normalizeSlotMuscles(skeleton, vocab)` runs after the architect: maps known strays through an alias map
  (`anti_rotation→core,obliques`, `scapular_stabilizers→upper_back`, `rotator_cuff→shoulders`,
  `rear_delts→shoulders`, `full_body→` drop, `cardiovascular→` drop, `single_leg_stability→glutes`), drops unknown
  values, and logs every change. A slot left with no muscles falls back to the muscles of its movement pattern
  (e.g. squat → quadriceps, glutes).
- Remove the non-muscle examples from `prompts.ts:252, 376-377, 410`.

### 5. Number limits and intensity_pct (findings 19, 3)

- `clampSlot(slot)` after the architect: `sets` → int 1-10, `rest_seconds` → int 0-600, `rpe_target` → 1-10 or
  null, `intensity_pct` → 30-110 or null. Every change is logged. Clamping is done in code, not in the Zod
  schema, so a slightly-out answer costs no retry.
- `SlotDetails` gains `intensity_pct`; `buildExerciseRows` saves it instead of null.

### 6. Contradictions removed (findings 8-14, 20, 21)

- **One priority ladder**, a constant `PRIORITY_LADDER` included in the analyzer (full), the architect (full,
  week, day) and the selector:
  1. Output contract — library ids only, the schema, slot ids.
  2. Safety — injury exclusions, the coach's explicit equipment setting, blocked exercises.
  3. The coach's own words for this run.
  4. The coach's Exercise Pool.
  5. Program continuity — split, training days, phase.
  6. The defaults in this prompt.
  The scattered "HIGHEST PRIORITY / override ALL" passages are reduced to a pointer to the ladder;
  `buildCoachInstructionsSection` keeps its specifics (counts, technique, order) but no longer claims to
  override safety.
- **Rotation:** delete week/day architect goal 3 ("Maintains exercise continuity for compound lifts"); keep
  weekly rotation of all working exercises; replace "< 3% repetition score" with the rule code checks ("no
  working exercise_id from the AVOID list, none twice in the week"). Progression wording talks about the slot
  (pattern and effort), not "the same lift".
- **Week 1 effort:** one value — primary compounds RPE 6-7 in week 1, 7-8 in week 2, 8-9 from week 3 (until a deload).
- **Time cap:** architect rules 2 and 16 gain "unless the coach stated an exercise count".
- **Beginner rule:** selector rule 3d becomes "the library you are given is already filtered to this athlete's
  level and week; prefer the simpler option when two fit equally". The hard-coded "NO barbell back squats…" list goes.
- **Day overlap:** day rule 3 and the "Other days" note become: "do not load the same movement pattern heavily
  within 48 hours of another day that already does; on full-body and DUP splits, repeating patterns is expected".
  The other-days rows gain sets and RPE so this can be judged.
- **Ceiling numbers:** the week analyzer's competing formula goes with the week analyzer (section 7); week/day
  ceilings are owned by code (`filterByProgressionPhase`). The full-program analyzer keeps its rule 20, because
  its `difficulty_ceiling` output is what `validateAssignmentAgainstCeiling` enforces there.
- **Log quality moves to the architect.** The "LOW log quality: do not autoregulate" section was only ever
  sent to the week analyzer; with the analyzer gone it goes into the week/day architect's message.
- **Deleted:** the "dumbbell throws" suggestion (`prompts.ts:94`) and `VALIDATION_AGENT_PROMPT` (never called).

### 7. Week/day analyzer removed; full-program technique repair (findings 15, 16)

- The week-scoped analyzer call (`week-orchestrator.ts:1134-1253`) and `WEEK_PROFILE_ANALYZER_PROMPT` go. Its
  output reaches code only as `training_age_category` (`exercise-filter.ts:406, 515`), which is built in code from
  `resolveClientDifficulty`. The `ProfileAnalysis` handed to the filter is assembled in code (today's fallback
  shape, which already exists at `:1221`). The compliance rebuild re-runs architect + selector only.
- Full program: `repairSkeletonTechniques(skeleton, analysis.technique_plan)` runs once after the architect and
  rewrites any disallowed technique to that week's `default_technique`, logging each change. The
  `technique_plan_violation` retry path then only fires for skeletons repair could not fix, which should be none.

## Phase 2 — strict template (gated)

Rewrite `buildArchitectPrompt` and `EXERCISE_SELECTOR_PROMPT` into: role (2 lines) · inputs, each with "if
absent, do X" · `PRIORITY_LADDER` · numbered hard rules, each checked by code or the judge · output contract ·
self-check list. Personas cut to two lines. Exercise ids become aliases `E1…En` per call, mapped back in code;
an unknown alias is treated exactly like today's hallucinated id. **Kept only if** the replay shows instruction
misses ≤ phase 1, zero sport/notes violations, poor fits ≤ phase 1, and cost ≤ phase 1 + 20%.

## Error handling

Every new code guard logs what it changed and never throws: a note emptied by `cleanNote` saves as null; a slot
left without muscles uses its pattern's defaults; clamps log the original value. Removing the analyzer removes
a failure path (its "fall back to mock analysis" branch becomes the normal path).

## Testing

- **Unit tests, one per pure function:** `normalizeSport`, `buildAthleteContext`, `resolveClientDifficulty` (Week/Day only; full programs keep their old defaults, pinned by `orchestrator-strict`),
  `cleanNote` (each sentence class, plus tempo and "tennis ball" kept), `per_side` append, library-name use in
  `buildExerciseRows`, `gradeFit`, `muscleVocabulary`, `normalizeSlotMuscles`, `clampSlot`, `intensity_pct`
  persisted, `repairSkeletonTechniques`. Each gets a mutant run (house rule: a green test proves nothing until a
  mutant turns it red).
- **Prompt tests:** the existing prompt assertions are updated. New ones: the ladder is present in every agent,
  the removed phrases are gone (continuity goal, "< 3%", dumbbell throws, split step, fixed percentages), and the
  muscle list and "sport is null" line appear when expected.
- **UI:** `GenerationWarnings` renders `slot_fit` with and without instructions. Real-app screenshots (light
  only; admin is light-only) of the card with substitutes.
- **Replay:** `scripts/replay-week-generation.ts` on the same five requests, before (main) and after, on the
  dev clone. A small scoring script reads the replay rows and reports: instruction misses, poor fits,
  cross-pattern swaps, notes naming a foreign sport, notes with prescription sentences, model names ≠ library
  names, cost and time.
- **Production check after deploy:** re-run the live queries above on rows created after the deploy.
- Gates: functions `tsc`, root `tsc` (236 baseline), targeted suites by file, `npm run test:integration:selects`
  before merge.

## Risks

- `cleanNote` may drop a useful sentence (e.g. a cue that mentions "3 seconds rest at the top"). It logs every
  drop; the replay review reads them.
- A stricter muscle list may make the selector's overlap match harder for niche slots (rotator cuff work maps
  to "shoulders"). The pattern + role match still carries those slots.
- Removing the analyzer loses its `notes` text, which nothing reads today.
