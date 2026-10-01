# Instruction compliance check — build report (2026-10-01, overnight)

Branch `worktree-instruction-compliance-check` (worktree `.claude/worktrees/instruction-compliance-check`),
18 commits on `main@fdc132bc`, head `becc5e37`. **Not pushed, not deployed.** Spec:
`docs/superpowers/specs/2026-10-01-instruction-compliance-check-design.md`; plan:
`docs/superpowers/plans/2026-10-01-instruction-compliance-check.md`.

## What it does

After Generate Day / Generate Week builds a day (or week) and BEFORE anything is saved:

1. **Exact checks in code** (`functions/src/ai/instruction-check.ts`, `instruction-count.ts`): the stated
   exercise count (day scope only), sets / reps / rest / tempo when written as a stand-alone value
   ("2-4 sets", "30-90 sec rest", "4-2-4 tempo"), Exercise Pool use (Preferred: every offered pool exercise
   used, or every slot a pool exercise; Strict: nothing outside the pool; warm-ups/cool-downs exempt),
   exercises the coach named in THIS generation's instructions, and ruled-out exercises.
2. **Opus 5.5 judges the rest** ("mainly shoulders", "some back", "power first", "leave 2 reps in reserve"),
   told which lines code already decided so it never re-judges them.
3. **One rebuild** when anything is unmet and time allows (`compliance-loop.ts`): planner + selector re-run
   with the misses spelled out; the attempt with fewer misses is kept (tie → the rebuild); a rebuild that was
   not AI-judged is compared on its exact checks only.
4. **Exactly one save** of the kept attempt; the checklist goes on the job result as `instruction_check`.
5. **The coach sees "Your instructions, checked"** — ✓ / ✗ per instruction with the evidence, "Rebuilt once
   to fix: …", and any note — on the jobs dock card and in the generation dialog
   (`components/admin/GenerationWarnings.tsx`). A miss also adds one line to "things to check".

Safety: a check, judge failure or time-out never fails a generation. The judge can only spend the time left
minus a 30 s save reserve (skipped under 5 s); running out of time during the rebuild or a check keeps the
first attempt with a note. No instructions and no pool → no check, no model call, behaves exactly as before.
The rebuild feedback never reaches the instruction parser (unlock/ban) or the instruction rewrite.

## Verified

- Functions: `tsc` clean; 278/278 across the 11 suites that import a changed module.
- App: 26/26 across the 4 suites that import a changed component; root `tsc` 235 errors (= main), none in
  changed files.
- `npm run test:integration:selects` against the dev clone: 24/24.
- Every task reviewed (spec + quality) with fix rounds until clean; an Opus whole-branch review → one fix
  wave → re-review → one targeted follow-up (Ruling 11) → re-review clean.
- Live, dev clone, real models, no client (the case Darren hits):
  | Run | Result |
  |---|---|
  | Darren's Preferred-pool instructions (01 Oct) | passed: sets/reps/rest/tempo ✓, pool 6/6 ✓, judge ran, no rebuild |
  | Darren's 30 Sep shoulder text ("12 exercises … mainly shoulder") | passed: 12 ✓ + 4 prescription ✓ + AI ✓ "mainly shoulder 9 of 12", "some back", "some chest" |
  | Hamstring focus + lunge/squat Preferred pool (forced conflict) | pool ✗; rebuilt once; rebuild missed more → first attempt kept and shown honestly; 222 s |
  | "8 exercises … Add 2 core exercises … Leave 2 reps in reserve … mainly legs" | no false count/reps line; judge caught "no RIR shown"; one rebuild set 2 RIR → all 7 lines ✓ |

## Not verified

- **Screenshots of the checklist in the real app.** The card reads job records from the production Firebase
  project, so a real finished card needs either this branch deployed or a hand-written production job doc.
  Both need your say-so. Take them right after deploy (dock card collapsed, dialog open, a ✗ + rebuild case).
- A run through the deployed function (all replays called the generator directly against the dev clone).

## Rulings made overnight (each with what it costs if wrong)

1. Every attempt object, including the cancelled early return, carries `durationMs` — a TS error only.
2. "Feedback never reaches the parser/enricher" is pinned by a source-level test (identifier appears exactly
   at its parameter and one call) — a creative future edit could slip past; the reviewers also read the path.
3. Limit / per-block / selection wording ("max 3 isolation exercises", "3 exercises per block") is not a
   stated count, also for the deployed planner directive — "at least 10 exercises" now takes the day's size
   from history.
4. "12 exercises per day / session / workout / training day" still counts as the day's total — harmless in
   week scope (no code count check there).
5. Warm-ups and cool-downs do not count against the Exercise Pool line — a strict-pool warm-up outside the
   pool would pass silently (strict selection draws every slot from the pool anyway).
6. Running out of time after a first attempt exists keeps and saves it (judge capped to remaining − 30 s,
   rebuild gate uses the same reserve, deadline during rebuild → first attempt) — a run that hit its budget
   saves a checked-but-not-rebuilt day instead of failing.
7. Cheap review minors folded in (stronger source guard, cancellation re-checked before save, comment) —
   nothing structural.
8. Screen-reader text "Met:/Not met:" and a heading count that never shows "0 not met" — nothing structural.
9. Both parsers are strict: an exact line only for stand-alone wording, everything else to the judge — some
   prose prescriptions ("3 sets of 10 reps", "rest 60-90 sec between sets") get the judge's reading only.
10. Further cheap minors folded in (tempo compared by digits, "rebuild missed more" note, honest notes when
    nothing could be checked, no empty dock gap, named lines only from the coach's own words, banned ids
    removed from named matches) — nothing structural.
11. One extra targeted fix after the final review (deviation from the one-fix-wave rule): a lone count is the
    day's total only when stated plainly ("12 exercises", "Choose 12 exercises"); "change 2", "plus 3", "also 2"
    etc. are not — "We'll do 12 exercises"-style wording gets no exact line, only the judge's; "Note from
    Darren: 12 exercises" no longer feeds the planner directive (falls back to the day's usual size).

## Needs your judgment

- **Preferred pool vs the coach's own focus.** The pool line counts any unused offered pool exercise as a
  miss, even when the coach's focus excludes it (a hamstring day with a lunge/squat pool). That costs one
  rebuild (~100 s) and shows a ✗. You chose "any pool exercise that could fit"; the cheap alternative is to
  let the AI judge pool fit when the instructions name a focus.
- **Deploy.** Push to main deploys the functions (CI) and the app (Vercel). No migration, no new secret.

## Known gaps, deferred

- Power / activation rows are held to the coach's single reps / rest / tempo line ("8-12 reps, power first"
  flags box jumps at 3).
- `duration_ms` / token totals cover only the kept attempt; the judge's tokens are not counted.
- A rebuild re-runs the instruction rewrite and parser (cost, a few seconds).
- The progress bar goes back to step 1 during a rebuild.
- A heading on the line above ("Main lifts:\n3 sets") is not scoped; its values apply to the whole day.
- The "ruled out" line can come from studio-policy bans, not only this generation's words.
