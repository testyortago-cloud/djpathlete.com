# Program generation prompts — strict review (full program, week, day)

Date: 2026-10-04. Scope: every prompt and user message the model sees when generating a full
program (`functions/src/ai/orchestrator.ts`), a week or a day (`functions/src/ai/week-orchestrator.ts`),
plus the shared pieces (`prompts.ts`, `shared-helpers.ts`, `dedup-verify.ts`, `instruction-enrich.ts`,
`instruction-check.ts`, `schemas.ts`). Read only — nothing was changed or run.

The standard applied: **a model can only be held to a rule if it is given the data the rule needs, the
rule does not contradict another rule, and code checks the rule afterwards.** Most hallucination in this
pipeline comes from breaking one of those three, not from the model being "creative".

---

## P0 — directly causes invented or wrong output

### 1. The selector is told to use data it never receives
The selector's system prompt has rules that depend on movement_confidence (rule 3d), injuries (rule 5),
sport (rules 11, 13), and injury_details × joints_loaded (rule 12) — `prompts.ts:484-529`.

What it actually receives as `Constraints`:
- Week/day: `available_equipment` + `client_difficulty` only — `week-orchestrator.ts:1449-1452`.
- Full program: the same, plus `exercise_constraints` — `orchestrator.ts:738-742`.

Neither path sends sport, injury_details, movement_confidence, likes or dislikes. So "when the client's
sport is known, strongly prefer sport_tags" can never fire, and the "moderate joint load → add a
modification note" rule can never be followed correctly. The code's joint filter removes *high*-load
exercises, but anything the model says about the injury in a note is a guess.

**Fix:** send a compact `athlete` block to the selector (sport, injury_details, movement_confidence,
dislikes, assessment max score) — or delete every rule that refers to data not sent. Never both absent.

### 2. Week/day planning runs on a thin profile
`week-orchestrator.ts:904-916` sends goals, level, injuries, equipment, minutes, days, techniques, sleep,
stress. Missing versus the full program (`orchestrator.ts:385-411`): sport, age, gender,
movement_confidence, training_years, occupation, likes, dislikes, training_background,
additional_notes, time_efficiency_preference — and the assessment results. A day for a tennis player
and a day for a golfer get identical context.

### 3. Example cues get copied into client-facing notes
Notes are shown to the client verbatim. The selector's note examples include sport-specific lines —
"think about your first step out of a split step" (`prompts.ts:536`) — and fixed percentages:
"4 × (2+2+1) @ ~85%" (`prompts.ts:345`), "Wave 1: 3@80%, 2@85%, 1@90%…" (`prompts.ts:556`). A model
under a "write coaching cues" instruction copies examples. Result: a swimmer told about a split step,
or a percentage the coach never wrote.

Worse, the architect's `intensity_pct` is **dropped at save** — `buildExerciseRows` writes
`intensity_pct: null` (`shared-helpers.ts:853`). So when a coach does write "75% 1RM", the only trace
that survives is whatever the selector chose to put in the note.

**Fix:** remove sport-specific and numeric examples from note guidance; add "a note may state a
percentage only if that slot's intensity_pct is set"; persist `intensity_pct` from the slot.

### 4. Notes have no "must agree with the slot" rule
Nothing forbids a note from stating sets, reps, rest, tempo or load that differs from the slot (the
example "3 each side" sits next to slots that may say 8), naming equipment the exercise does not use,
or making medical claims. These are the most visible hallucinations because the athlete reads them.

**Fix:** a hard rule — "Notes never restate or change sets, reps, rest, tempo, RPE or load; they give
technique cues only" — plus a cheap code check: any digit-bearing token in a note that does not match
the slot's own fields gets the sentence stripped (the `stripPipelineInternals` machinery already does
this kind of sentence removal).

### 5. The model's exercise_name is trusted
`buildExerciseRows` builds `nameBySlotId` from the model's `exercise_name` (`shared-helpers.ts:832`),
and that name replaces slot refs in notes ("Superset with …"). Invalid IDs are stripped, but a VALID id
paired with the WRONG name is never caught: the row saves exercise A while the partner's note says
"Superset with B".

**Fix:** always take the name from the library row for that id; log a mismatch.

### 6. Forced fill with no way to say "this is a poor fit"
"NEVER leave a slot without an assignment" (`prompts.ts:458`) plus heavy rotation pressure means that
when the library runs out, the model silently fills a squat slot with a jump or a core exercise —
the 2026-08-31 week had 27 of 72 slots swapped across movement patterns while every check passed.
`substitution_notes` is a free-text array no code reads.

**Fix:** add `fit: "exact" | "close" | "poor"` and `fit_reason` to each assignment in the schema. Code
counts `poor`, surfaces it to the coach, and refuses a `poor` when an `exact` candidate exists for that
pattern. Giving the model an honest outlet is the single best anti-hallucination lever here.

### 7. target_muscles is an open vocabulary
The architect is free to write any string; the prompt's own examples write things that are not muscles
— "anti-rotation", "single-leg stability", "scapular_stabilizers", "cardiovascular", "full_body"
(`prompts.ts:252, 376-377, 410`). The selector is then told target_muscles "must overlap with the
exercise's primary_muscles" (`prompts.ts:482`). It cannot, so it guesses.

**Fix:** give the architect the closed list of `primary_muscles` values actually present in the
library (and make the schema an enum of them, or validate and remap in code).

---

## P1 — contradictions (the model picks a side, differently each run)

### 8. Rotate every lift weekly vs. progressive overload
- Week/day architect: goal 3 says "Maintains exercise continuity for compound lifts while rotating
  accessories" (`week-orchestrator.ts:366, 371`); rules 5 / 3 of the same prompt say "ROTATE ALL WORKING
  EXERCISES" (`:386, :401`). Same prompt, opposite instructions.
- Full program: the selector must change the primary lift every week (Back Squat → Front Squat →
  Goblet Squat → Single-Leg Press, `prompts.ts:501`), while the architect is told linear periodization
  means "gradually increase intensity" and primary RPE builds 7-8 → 8-9 (`prompts.ts:307, 331`).
  Progressing load on a different lift each week is not progressive overload; any S&C coach would
  hold a main lift for a 3-4 week block and rotate accessories every 2-3 weeks.
- "Target < 3% repetition score" (`prompts.ts:498, 507`; `dedup-verify.ts`) is a number the model
  cannot compute. Replace with the concrete rule code actually checks.

**Decision needed from the owner:** keep weekly rotation of main lifts (current behaviour, enforced by
the dedup verifier), or hold main lifts per block. The prompts must then say one thing.

### 9. Time budget vs. the coach's count
Architect rule 2 says "NEVER exceed these caps"; rule 16 says "REMOVE the lowest-priority exercise
slot" if over time (`prompts.ts:288, 365`), with no exception; rule 19 says a coach count overrides the
caps (`:387`). Rule 16 needs "unless the coach stated a count".

### 10. Week 1 RPE
Rule 8: "Week 1 … RPE 6-7" (`prompts.ts:316`). Rule 11: primary compound "RPE 7-8 in weeks 1-2" (`:331`).

### 11. "Beginners: ONLY beginner exercises"
Selector rule 3d (`prompts.ts:485`) says only beginner-tier. The code deliberately admits
intermediate exercises with score ≤ 4 from week 3 (`exercise-context.ts:61-62`), and the analyzer may
raise the score cap. The selector is handed exercises its prompt forbids. The hard-coded "NO barbell back
squats, NO barbell deadlifts" list also overrides the library's own tags.

### 12. Day mode "don't duplicate patterns" breaks full-body splits
Day rule 3 and the "Other days" block say "Do NOT duplicate the same primary muscle groups or movement
patterns" (`week-orchestrator.ts:384, 1003`). On a full_body split every day trains squat/hinge/push/pull;
under DUP the same lift is meant to repeat. The real constraint is heavy same-pattern loading within
48 h and weekly volume — and the "other days" rows carry no sets or RPE, so the model cannot judge load.

### 13. No single priority ladder
"HIGHEST PRIORITY" appears 6 times, "override ALL" in several places, each with a different list
(`shared-helpers.ts:78`, `prompts.ts:176, 349, 386`, `week-orchestrator.ts:387, 403, 1016`). None says what
the coach CANNOT override. "COACH INSTRUCTIONS OVERRIDE ALL" (`prompts.ts:349`) literally covers
injuries, equipment and the library. Write one ladder, put it in every agent, and delete the rest:

1. Output contract: library ids only, schema, slot ids.
2. Safety: injury exclusions, the coach's explicit equipment setting, blocks.
3. The coach's explicit words for this run.
4. The coach's Exercise Pool.
5. Program continuity (split, days, phase).
6. Defaults in this prompt.

### 14. The difficulty ceiling has three different formulas
Full analyzer rule 20: weeks 3+ → 6 (`prompts.ts:195`). Week analyzer rule 7: weeks 3-5 → 5-6, 6+ → 6-7
(`:628`). Week fallback in code: `newWeekNumber <= 2 ? 4 : 6` (`week-orchestrator.ts:1132`).

---

## P1 — the prompts promise checks the pipeline does not make

### 15. The week/day analyzer is decorative
It runs AFTER the architect (step 2.5, `week-orchestrator.ts:1134`), so the architect never sees its
technique_plan. Its technique_plan and difficulty_ceiling are never validated in week mode — only
`training_age_category` is read, by the filter (`exercise-filter.ts:406`). Yet the full-program wording it
inherits says violations "cause regeneration". Either move it before the architect and enforce its
output, or remove it and save a Sonnet call per run.

### 16. Full program: a technique violation is retried with the wrong agent
`validateSkeletonAgainstAnalysis` flags the ARCHITECT's techniques (`orchestrator.ts:1066-1075`), but the
skeleton is fixed (`const skeleton`, `:681`) and only the selector is re-run. It cannot change a slot's
technique, so those retries cannot pass. (Verify: no repair step was found by search.)

### 17. Full programs have none of the week/day hardening
`orchestrator.ts` never calls `enrichCoachInstructions`, `buildNamedNote`, `buildPreferredPoolPlanSection`
or `checkInstructions`. The fixes from 2026-10-01 and 10-02 (named exercises reaching the selector, the
pool reaching the architect, the instruction checklist) exist only for Generate Week/Day. A full program
with "include box jumps" still has the bug those fixed.

### 18. The program arc lacks what deload and progression decisions need
`buildWeekFocusSummary` gives muscles, patterns and names per week — no phase, intensity_modifier, sets
or RPE (`week-orchestrator.ts:479-532`); `programSummary` has no phase plan (`:867-875`). "Deload every
3-4 weeks of hard training" is decided without knowing which past weeks were deloads. Add phase and
intensity_modifier per week (they are stored on the skeleton; check whether they persist per week).

### 19. Schema enforces none of the numeric "hard caps"
`sets`, `rest_seconds`, `rpe_target` are bare `z.number()` (`schemas.ts:112-115`): 0 sets, 3.5 sets, RPE 11
and 900 s rest all pass. Add `.int().min().max()`; and when the coach stated no count, check slot count
against the session cap in code.

### 20. Dead prompt
`VALIDATION_AGENT_PROMPT` (`prompts.ts:560`) is never called. The "4th agent" is code
(`lib/ai/validate.ts`). Delete it so nobody tunes a prompt that never runs.

---

## P2 — safety and hygiene

21. **Unsafe suggestion:** analyzer rule 3 says "no medicine balls → use dumbbell throws"
    (`prompts.ts:94`). Remove.
22. **Persona bloat:** ~84 KB of prompt source, much of it philosophy ("lateral thinking", "question
    assumptions", "creative solutions"). For structured planning this invites invention and buries
    rules (46 MUST, 15 NEVER, 7 CRITICAL across the prompt files). Cut each persona to two lines; keep
    only rules code or the judge can check.
23. **UUIDs in the library:** the model copies 36-character UUIDs. Short aliases (`E1`…`En`) mapped back in
    code remove corrupted ids and cut tokens. Invalid ids are stripped today
    (`week-orchestrator.ts:1541`) but each one costs an empty slot and a retry.
24. **Inconsistent defaults with no profile:** week selector says `client_difficulty: "advanced"` under
    ignore_profile (`week-orchestrator.ts:1451`); full program says `"beginner"` (`orchestrator.ts:741`);
    week filtering uses `"intermediate"` when there is no profile (`:1125`). The same client gets a
    different library depending on which button was pressed.
25. **Assessment line goes to the wrong agent:** "Only select exercises with difficulty_score ≤ X" is
    given to the analyzer, which selects nothing (`orchestrator.ts:427`). Week/day ignore the assessment
    entirely.

---

## What a strict prompt looks like here

Each agent gets the same skeleton:

1. **Role** — two lines.
2. **Inputs you will receive** — enumerated, each with "if absent, do X" (never "assume").
3. **Priority ladder** — the six levels above, verbatim in every agent.
4. **Hard rules** — numbered, each one checkable by code or the judge; no rule without a check.
5. **Output contract** — including `fit` / `fit_reason` and a way to say "not possible".
6. **Self-check** — a short list run before answering (counts, ids from library, notes agree with slots).

And one rule for the code: *every rule the prompt calls validated must actually be validated.*

## Suggested order of work

1. P0 items 1, 4, 5, 6, 7 + schema bounds (19). Mostly data plumbing and small code checks; largest
   reduction in visible hallucination.
2. Owner decision on item 8 (rotation vs. block continuity), then de-contradict 8-14 with one ladder.
3. Port week/day hardening to full programs (17); fix or remove the week analyzer (15) and the
   full-program retry (16).
4. Trim personas and switch to id aliases (22, 23).

Measure each step with `scripts/replay-week-generation.ts` on the five real requests already used
(instruction-check misses, `poor` fits, cross-pattern swaps, note/slot disagreements, cost), plus at
least one full-program replay, which has never been replayed on GPT-6.1 Sol.
