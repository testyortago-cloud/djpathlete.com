# Strict generation prompts — results

Branch `worktree-generation-strict-prompts` (worktree `.claude/worktrees/generation-strict-prompts`), 17 commits on `87a097c1`, head `39cd4db7`. Spec and plan: `docs/superpowers/specs|plans/2026-10-04-generation-strict-prompts*`. Not merged, not pushed, not deployed.

## What changed

Generate Week and Generate Day now tell the AI everything their own rules depend on, stop it contradicting itself, and check its output in code.

- **The AI gets the athlete's data.** Week/Day use the full client profile (sport, age, movement confidence, dislikes, background). The exercise picker receives the athlete's sport, injuries, movement confidence and dislikes. One "no profile" difficulty default replaces three conflicting ones.
- **Notes are cues only.** Code removes any note sentence that states sets, reps, rest, RPE, a percentage or a per-side count, and any sentence naming a sport other than the athlete's. A note that is entirely prescription saves as empty. The picker returns `per_side`, and code adds "each side" to the reps. Names inside notes come from the library, not from the model.
- **Poor substitutes are reported.** Each pick carries `fit` (exact / close / poor) and a reason. Code re-checks it against the slot's movement type. Poor fits are listed on the finished generation under "Substitutes the AI had to make" (dialog and dock). They never trigger a rebuild.
- **Muscle names come from a closed list** built from the exercise library. Sets, rest, RPE and percentage are clamped in code. The coach's percentage is now saved; an invented one is removed unless the coach wrote a percentage.
- **One priority ladder** (output contract, safety, the coach's words, the pool, program continuity, defaults) in every planning prompt. Contradictions removed: week 1 effort, time cap versus the coach's count, "beginner exercises only", day overlap, the coach overriding injuries. Two unused prompts deleted. Weekly rotation of main lifts is unchanged (owner decision).
- **Week/Day analyzer removed** (it ran after the planner and nothing checked it). Full programs repair technique mistakes in code instead of retrying the wrong step, and respect a technique the coach named.

## Measured: five real requests, before and after

Same five production requests replayed on the dev clone (GPT-6.1 Sol), one stand-in client (tennis), appended as week 13 of one clone program. Before = `a10ad144` (scorer only, generation code unchanged). After = `39cd4db7`.

| | Before | After |
|---|---|---|
| Notes that restate sets / reps / rest / RPE / % | 126 of 126 | **0 of 116** |
| Notes naming a foreign sport | 0 (not measurable, see below) | 0 |
| Coach instructions unmet | 19 of 114 | 17 of 112 |
| Poor substitutes listed to the coach | none shown | 29 (all visible) |
| Rebuilds triggered | 1 | 4 |
| Cost | $1.80 | $2.01 (+12%) |
| Time | 1248 s | 1274 s |

Per request, instructions unmet: t1 1→2, t2 4→5, t3 6→2, t4 6→5, t5 2→3 (of 10-33 each). Three requests are one worse, two are better; with five samples that is noise, not a trend.

## What this does not prove

- **The sport fix is untested by replay.** The stand-in client plays tennis, so "foreign sport" was 0 before and after. It is proven by unit tests only. The real proof is the live check after deploy (below).
- **Rebuilds went from 1 to 4 of 5.** I don't know why. Poor fits cannot cause a rebuild by design, and the instruction check reads the exercise table, not the notes. Likely model variation between runs, but it is unexplained and costs time and money when it happens. Worth one more replay after merge.
- **Nothing ran against production.** No real-app screenshots exist yet: the new panel reads job results that only the deployed function writes, and I will not fake it in a harness.

## Still to do (needs you)

1. Merge to `main` (CI deploys the functions and the app). Run `npm run test:integration:selects` first; it passed 24/24 on this branch.
2. After deploy, run one real Generate Day on a test program, screenshot the dialog and dock with the new panel (light only), annotate and save under `screenshots/generation-strict-prompts/`. To force a poor fit, use a strict pool smaller than the slot count; do not edit the database.
3. After deploy, re-run the live read-only checks on rows created after the deploy: AI notes naming a sport different from the assigned client's, and AI notes matching the prescription pattern. Expected 0 and 0.

## Decisions made on your behalf

See the "Rulings" list in the hand-off message. The two that change behaviour you may care about:

- **Full-program difficulty default.** With "ignore profile" it is now "advanced" (was effectively "beginner" in weeks 1-2: full programs were limited to beginner exercises). With no profile it is "intermediate" (was "beginner"). Say so if you want the old behaviour for full programs.
- **Percentages in your instructions.** One "%" anywhere in the coach's text keeps every slot's percentage for that run; without one, the AI's percentages are removed.

## Known limits (deferred, none block merge)

Spelled-out numbers ("two sets of eight"), RIR and load numbers in notes are not caught; the substitutes check uses fixed movement-type groups, so a few legitimate picks (for example a hinge in a squat slot) will be listed as substitutes; the technique keyword match over-protects a technique when the coach writes "no supersets"; cluster rest and EMOM minutes no longer fit in notes (cues only, no field); full programs get fit grading only through shared code, not the coach-facing panel.
