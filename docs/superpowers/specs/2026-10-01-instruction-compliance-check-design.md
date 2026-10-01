# Instruction compliance check for Generate Day / Generate Week

Date: 2026-10-01. Owner decisions taken in chat the same day (all "1"): rebuild once then report;
Day and Week generation only; Opus 5.5 judges; a Preferred pool counts as missed when any pool
exercise that could fit is left out; the coach always sees a checklist. Approach A ("check after
selection, before saving") approved with "lgtm". The owner then went to sleep and asked for the work
to be carried to completion autonomously, short of pushing or deploying.

## Why

Two production reports in two days (2026-09-30, 2026-10-01) were generations that quietly did not do
what the coach wrote: "12 exercises" produced 1, then 2; "use the exercise pool (6 selected)" used
none. Each was a different root cause, each was fixed, and each was only discovered by the coach
reading the finished day. Nothing in the pipeline compares the finished day with the coach's own
words. This adds that comparison, acts on it once, and shows the coach the result.

## What the coach gets

On every Generate Day / Generate Week that had instructions, the finished card (the jobs dock and the
generation dialog) shows a checklist under "How the AI read your instructions":

    Your instructions, checked
    ✓ 12 exercises — 12 in the day
    ✓ Exercise Pool — all 6 used
    ✓ 2-4 sets — every exercise has 2-4
    ✗ 30-90 sec rest — "Banded shoulder press" rests 120 s
    ✓ Mainly shoulders — 7 of 12 train the shoulders
    Rebuilt once to fix: only 4 of 6 pool exercises were used.

Unmet lines also produce one entry in the existing "things to check" warnings, so a miss is visible
even with the checklist collapsed. When the check itself could not run, the card says so in one line
("Couldn't check your instructions this time") and the day is saved as normal.

No instructions → no checklist (nothing to check). A Preferred or Strict pool with no instructions
still gets the pool line.

## Pipeline change (functions/src/ai/week-orchestrator.ts)

Today `generateWeekSync` loads context, plans (architect), selects, verifies, then saves (Step 4:
rows, log-quality history, program/assignment duration). Everything with a side effect is in Step 4.

Split it, without changing what an attempt does:

1. `buildWeekAttempt(request, ctx, opts)` — everything up to Step 4, returning the attempt (skeleton,
   assignment, exercise rows ready to insert, warnings, instructions_used, facts the checker needs).
   Takes an optional `complianceFeedback: string` that is appended, as its own clearly-labelled
   section, to the instructions the ARCHITECT and the SELECTOR read. It never reaches the instruction
   parser (unlock/ban) or the enricher — same rule as the enrichment: generated text must not be able
   to unlock or ban an exercise.
2. `checkCompliance(attempt, request)` — returns an `InstructionCheck` (below).
3. Orchestration in `generateWeekSync`:
   - attempt 1 → check 1.
   - If check 1 has unmet lines AND the deadline has at least `1.3 × attempt-1 duration` left:
     attempt 2 with feedback built from the unmet lines → check 2. Keep the attempt with fewer unmet
     lines (attempt 2 on a tie).
   - Persist the kept attempt (the existing Step 4, unchanged), return its result plus
     `instruction_check`.
   - If there is not enough time for attempt 2, report check 1 as is with `rebuilt: false` and a note.
   - The rebuild runs at most once. Cancellation is checked before it.

Attempt 2 re-runs context loading, enrichment and intent parsing (a few seconds and DB reads) rather
than threading them through — keeping the attempt function identical to today's code path is worth
more than those seconds.

## The check (new module functions/src/ai/instruction-check.ts)

```ts
interface InstructionCheckItem {
  instruction: string        // the coach's words this line is about (short)
  met: boolean
  detail: string             // plain-language evidence, e.g. "12 in the day", "rests 120 s"
  source: "code" | "ai"
}
interface InstructionCheck {
  status: "passed" | "failed" | "unchecked"   // unchecked = nothing could be judged
  items: InstructionCheckItem[]
  rebuilt: boolean
  rebuild_reason: string | null              // the attempt-1 misses that triggered the rebuild
  note: string | null                        // e.g. "The AI check failed, so only counts were checked."
}
```

### Code checks (exact, run first)

- **Exercise count.** `statedExerciseTotal(instructions)` (instruction-count.ts) returns the one
  unambiguous total when the coach stated one ("12 exercises", "12 exercises total"; a line saying
  "total" wins over per-area counts; otherwise several counts → null). Met when the day's count equals it.
  Day scope only. In week scope "12 exercises" could mean per day or per week, so the count is left
  to the AI line, which sees every day.
- **Exercise Pool.** Preferred: met when every pool exercise that was offered to the selector is
  used, OR the day has fewer slots than offered pool exercises and every slot is a pool exercise.
  Strict: met when every exercise is from the pool. Detail names the unused ones.
- **Named exercises** (the instruction parser's unlocked set — the coach typed their names):
  met when each appears. **Banned** (parser's banned set): met when none appears.
- **Prescription ranges**, parsed from the ORIGINAL text only when written as a single range or
  value on its own: `N-M sets`, `N-M reps`, `N-M sec|s|seconds rest`, a tempo like `4-2-4`.
  Each is one line; met when every working exercise is inside it. Holds (reps written as a time)
  and warm-up/cool-down roles are exempt from the reps line. Detail names the first offender.

### AI check (Opus 5.5, after the code checks)

One `callAgent` call, `MODEL_OPUS_5_5`, `allowHaikuFallback: false`, own 30 s timeout inside the
generation deadline, structured output `{ items: [{ instruction, met, detail }] }`.

Input: the coach's original words; the finished day/week as a compact table (day, order, name,
movement pattern, primary muscles, role, sets, reps, rest, tempo); the code-check lines already
decided ("do not re-judge these"). Prompt rules: split the coach's words into individual instructions;
judge only the ones not already decided; judge from the table only; be literal ("mainly X" = at least
half of working exercises train X; "power first" = power-role exercises come first); short detail
with the evidence; never invent an instruction.

Failure (error, timeout, empty) → keep the code lines, `note` says the AI part did not run. The
generation's own deadline aborting is rethrown, as in the enricher.

### Status

`failed` if any item is unmet; `passed` if all met and at least one item exists; `unchecked` if no
item could be produced (no instructions and no pool, or everything failed).

## Feedback for the rebuild

Built from unmet lines only, e.g.:

    PREVIOUS ATTEMPT MISSED THESE COACH INSTRUCTIONS — fix every one:
    - Exercise Pool: Ballerina bulgarians, Prone dumbbell reaching press were not used. Plan slots they fit and use them.
    - 30-90 sec rest: "Banded shoulder press" rested 120 s.

## Result, UI, warnings

- `result.instruction_check` on the job doc (week-generation.ts passthrough, next to
  `instructions_used`).
- `components/admin/GenerationWarnings.tsx`: `extractInstructionCheck(result)` (defensive, like
  `extractInstructionsUsed`) and `InstructionCheckPanel` — ✓/✗ list, the rebuild line, the note.
  Rendered in `JobsNotificationDock` (collapsed) and `GenerationDialog` (open), under the
  instructions panel. Light-only admin styling; semantic tokens (`text-success`, `text-error`).
- One warning line when unmet items remain:
  "2 of your instructions weren't fully met — see “Your instructions, checked”."

## Out of scope

Full program generation (orchestrator.ts), program chat, blocking the save, a second rebuild,
per-coach settings. A feature flag is not added: the check is cheap, reports only after one bounded
rebuild, and never blocks a save.

## Testing

- Unit: `statedExerciseTotal`; each code check (pass and fail, holds exempt, roles exempt); status
  rules; feedback text; attempt selection (fewer unmet wins, tie → attempt 2); time gate.
- AI check with `callAgent` mocked: items merged after code lines, failure → note + code lines kept,
  outer abort rethrown, the prompt carries the original words and the "already decided" list.
- Orchestrator: attempt 2 runs only on a failed check with enough time; feedback reaches the architect
  and selector messages but NOT `extractInstructionIntent` or the enricher; exactly one save; the
  kept attempt is the one saved.
- UI: panel renders ✓/✗, rebuild line, note; `extract*` tolerates missing/garbage.
- Live: Darren's program copy on the dev clone — his two real instructions (expect pass), a run with
  an unmet instruction forced (expect one rebuild and the checklist), "12 exercises … mainly shoulder".

## Cost and time

One Opus call per generation (~5-10 s, a few cents). A rebuild only on a miss: day ≈ +60-90 s; week
only when time remains.
