# RPE Data-Quality Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the AI from silently progressing loads when the client doesn't log RPE/weight. Three fixes ship together: (1) prompt rule for null metrics, (2) UI nudge requiring RPE before completion, (3) orchestrator data-quality awareness with fallback to fixed progression.

**Tech Stack:** TypeScript (Firebase Functions + Next.js 16 App Router + React 19), Vitest, Tailwind, shadcn/ui.

**Design context:** `exercise_progress` columns (`weight_kg`, `rpe`, `sets_completed`, etc.) are all nullable. Today the AI sees nulls and guesses progression. Bodyweight exercises legitimately have null weight and need to keep that flexibility.

**Solo dev convention:** Commit directly to `main`. Each task = one commit. Don't `cd ..` out of project root.

---

## Task 1 — Prompt rule for null metrics

**Files:**
- Modify: `functions/src/ai/prompts.ts`
- Modify: `functions/src/ai/week-orchestrator.ts` (the `buildArchitectPrompt` rules section)

**Step 1: Update WEEK_PROFILE_ANALYZER_PROMPT**

Find `WEEK_PROFILE_ANALYZER_PROMPT` in `functions/src/ai/prompts.ts`. In the "CRITICAL RULES" numbered list, append a new rule (renumber if 11+):

```
11. NULL METRIC HANDLING (autoregulation guard): When the recent performance logs show a completed exercise where weight_kg or rpe is null, treat that exercise as "completed without effort signal" — DO NOT use it to argue for progressive overload. For these exercises in the next week, keep the load/intensity prescription the same as the most recent prescribed value (no auto-bump). When more than half of recent logs lack rpe, prefer conservative volume_targets and add a note "log_quality: low" in `notes`.
```

**Step 2: Update PROGRAM_ARCHITECT_PROMPT**

Find `PROGRAM_ARCHITECT_PROMPT` in the same file. The progression rules are at "11. RPE/RIR targets — these are AUTO-REGULATION tools…". Right after that block (or wherever the autoregulation rules live), append:

```
12. NULL METRIC HANDLING: If the user message includes performance logs with null weight_kg or null rpe on completed exercises, do NOT treat those as "the client crushed it" or "the client struggled" — treat them as no-signal. Keep the prescribed sets/reps/RPE targets identical to the prior prescription rather than auto-progressing.
```

(If 12 already exists, insert as the next available number.)

**Step 3: Update buildArchitectPrompt rules**

In `functions/src/ai/week-orchestrator.ts`, find `buildArchitectPrompt(mode: "week" | "day")`. Both `isDay ? rules : rules` blocks have a numbered list. Append (or insert as the next number) a rule to BOTH:

For the day branch:
```
9. NULL METRIC HANDLING: When the recent performance logs show completed exercises with null rpe or null weight_kg, do NOT use them as a progression signal. Repeat the prior week's load/intensity prescription verbatim for those exercises. Only auto-progress where rpe was actually logged.
```

For the week branch (after rule 9, "Output ONLY the JSON object"):
```
10. NULL METRIC HANDLING: When the recent performance logs show completed exercises with null rpe or null weight_kg, do NOT use them as a progression signal. Repeat the prior week's load/intensity prescription verbatim for those exercises. Only auto-progress where rpe was actually logged. Do NOT add new accessory volume justified by "the client tolerated last week well" if last week has no rpe.
```

Renumber existing rules as needed.

**Step 4: Build check**

```bash
cd functions && npm run build
```

Expected: clean.

**Step 5: Commit**

```bash
git add functions/src/ai/prompts.ts functions/src/ai/week-orchestrator.ts
git commit -m "feat(ai): treat null rpe/weight as no-progression-signal in prompts"
```

---

## Task 2 — UI: require at least one set's RPE before completion

**Files:**
- Modify: `components/client/WorkoutDay.tsx`

**Context:**
- `WorkoutDay.tsx` already tracks set rows with per-set rpe (`row.rpe`, see line 685's `Select` for the picker).
- Bodyweight exercises (`is_bodyweight`) skip RPE intentionally — line 200's "Bodyweight exercises don't need weight or RPE" branch.
- The submit handler maps `set_details` → server. We want to add a client-side gate: before posting `/api/client/workouts/log`, if the exercise is NOT bodyweight AND no set has rpe, show an inline error and block submit.

**Step 1: Locate the submit handler**

Read `components/client/WorkoutDay.tsx` and find the function that submits the per-exercise log (the place that calls `/api/client/workouts/log` or similar). Identify:
- The exercise's `is_bodyweight` flag from the program_exercises join.
- The collection of filled sets (rows where reps > 0 or weight > 0).
- Where the submit currently happens.

**Step 2: Write the gate**

Just before the fetch/post call, add:

```typescript
const isBodyweight = pe.exercises?.is_bodyweight ?? false
const filledSets = setRows.filter((r) => r.reps > 0)  // adjust to match the existing fill check
const hasAnyRpe = filledSets.some((r) => r.rpe != null && r.rpe >= 1 && r.rpe <= 10)

if (!isBodyweight && filledSets.length > 0 && !hasAnyRpe) {
  toast.error("Add an RPE on at least one set before completing — even a single number helps the AI plan your next session.")
  return
}
```

Use whatever toast/error library the file already uses (check imports — `sonner` per CLAUDE.md). If `pe.exercises?.is_bodyweight` isn't available in the current shape, find where bodyweight is derived in this component and reuse.

**Step 3: Add a visual hint near the RPE column**

Find the section that renders the RPE select header. Add a small "Required for non-bodyweight" hint below the column header for non-bodyweight exercises, styled subtly:

```tsx
{!isBodyweight && (
  <span className="text-xs text-muted-foreground">RPE required to complete</span>
)}
```

(Place it under the existing "RPE" label cell. Keep it small; don't disrupt layout.)

**Step 4: Manual test**

```bash
npm run dev
```

Open the client workout view, find a non-bodyweight exercise, fill reps but leave RPE blank, attempt to mark complete → expect the toast and no submission. Then add an RPE to one set → expect successful submission. For a bodyweight exercise, RPE-less completion should still work.

**Step 5: Commit**

```bash
git add components/client/WorkoutDay.tsx
git commit -m "feat(client): require RPE on at least one set before completing non-bodyweight exercises"
```

---

## Task 3 — Orchestrator data-quality awareness

**Files:**
- Modify: `functions/src/ai/week-orchestrator.ts`
- Test: `functions/src/ai/__tests__/week-orchestrator.test.ts` (add a unit for the helper)

**Context:**
- After reading recentProgress, compute a "log quality" ratio: how many of those logs have rpe vs total.
- When quality is low (< 0.5), the orchestrator already wants to fall back to fixed progression. We surface this two ways:
  1. Add a `log_quality_note` to the analyzer message so Agent 1 knows to be conservative.
  2. Stamp the result on `program.ai_generation_params.log_quality` (or the generation log) so the coach can see why the AI didn't autoregulate.

**Step 1: Add the helper**

In `functions/src/ai/week-orchestrator.ts`, add a small pure helper near `buildWeekFocusSummary`:

```typescript
/**
 * Compute the fraction of recent logs that have rpe recorded.
 * Used to decide whether the AI should autoregulate or fall back to fixed progression.
 * Returns 1.0 when there are no logs (no signal to lose).
 */
export function computeRpeLogQuality(
  logs: Array<{ rpe?: number | null; weight_kg?: number | null }>,
): { quality: number; sample_size: number } {
  if (logs.length === 0) return { quality: 1.0, sample_size: 0 }
  const withRpe = logs.filter((l) => l.rpe != null && l.rpe >= 1 && l.rpe <= 10).length
  return { quality: withRpe / logs.length, sample_size: logs.length }
}
```

**Step 2: Wire it in**

After `recentProgress` is fetched (around line 368), compute:

```typescript
const logQuality = computeRpeLogQuality(recentProgress as Array<{ rpe?: number | null; weight_kg?: number | null }>)
const lowQuality = logQuality.sample_size > 0 && logQuality.quality < 0.5
console.log(
  `[week-orchestrator] log quality: ${(logQuality.quality * 100).toFixed(0)}% (n=${logQuality.sample_size})${lowQuality ? " — LOW: skip autoregulation" : ""}`,
)
```

**Step 3: Add to analyzer message**

In the analyzer message string (the one that goes to `WEEK_PROFILE_ANALYZER_PROMPT`), append a section right before `## Coach Instructions` (or before `## Target Week`):

```typescript
## Log Quality
${
  lowQuality
    ? `LOW (${(logQuality.quality * 100).toFixed(0)}% of ${logQuality.sample_size} recent logs include RPE). Do NOT autoregulate based on this data — keep prescriptions matching the prior week. Use fixed progression only (e.g., +small linear bumps based on weeks elapsed, not RPE).`
    : `OK (${(logQuality.quality * 100).toFixed(0)}% of ${logQuality.sample_size} recent logs include RPE).`
}
```

**Step 4: Stamp the result on the generated program**

The existing `bulkAddExercisesToProgram` flow doesn't return the program object directly — but the week-orchestrator updates the program's metadata via the `programs` table. To surface log quality to the coach, write it on the program's `ai_generation_params` JSONB:

Find where the program is updated after generation (or where the new week is appended). Add a non-blocking update:

```typescript
try {
  const supabase = getSupabase()
  const { data: existing } = await supabase
    .from("programs")
    .select("ai_generation_params")
    .eq("id", request.program_id)
    .single()
  const params = (existing?.ai_generation_params as Record<string, unknown>) ?? {}
  const log_quality_history = (params.log_quality_history as Array<unknown>) ?? []
  log_quality_history.push({
    week_number: newWeekNumber,
    quality: logQuality.quality,
    sample_size: logQuality.sample_size,
    autoregulated: !lowQuality,
    generated_at: new Date().toISOString(),
  })
  await supabase
    .from("programs")
    .update({ ai_generation_params: { ...params, log_quality_history } })
    .eq("id", request.program_id)
} catch (e) {
  console.warn("[week-orchestrator] log_quality stamp failed (non-blocking):", e instanceof Error ? e.message : e)
}
```

Place this AFTER the bulkAddExercisesToProgram + recordUsageFromFn block, just before the `if (!isFillingBlank && !isSingleDay)` duration update.

**Step 5: Add test**

Append to `functions/src/ai/__tests__/week-orchestrator.test.ts`:

```typescript
import { computeRpeLogQuality } from "../week-orchestrator.js"

describe("computeRpeLogQuality", () => {
  it("returns 1.0 with sample 0 when no logs", () => {
    const r = computeRpeLogQuality([])
    expect(r.quality).toBe(1.0)
    expect(r.sample_size).toBe(0)
  })

  it("counts logs with valid rpe (1-10) only", () => {
    const r = computeRpeLogQuality([
      { rpe: 8 },
      { rpe: null },
      { rpe: undefined },
      { rpe: 0 },
      { rpe: 11 },
      { rpe: 7 },
    ])
    expect(r.sample_size).toBe(6)
    expect(r.quality).toBeCloseTo(2 / 6, 4)
  })

  it("returns 1.0 when all logs have rpe", () => {
    const r = computeRpeLogQuality([{ rpe: 7 }, { rpe: 8 }])
    expect(r.quality).toBe(1.0)
  })
})
```

The function must be exported (Step 1 already does so). The mock at the top of the file may need to import this function — if so, simply import it, no extra mocking required since it's pure.

**Step 6: Build + test**

```bash
cd functions && npm run build
cd functions && npm test
```

Expected: clean build, all tests pass (now 234 with the 3 new ones).

**Step 7: Commit**

```bash
git add functions/src/ai/week-orchestrator.ts functions/src/ai/__tests__/week-orchestrator.test.ts
git commit -m "feat(ai): skip autoregulation when RPE log quality is low; stamp on program"
```

---

## Self-review

- Task 1 closes the "agent guesses on null RPE" loop in prompt-space.
- Task 2 prevents the input gap from happening at the source (UI requires RPE on at least one set).
- Task 3 makes the orchestrator graceful when prior data is sparse — fixed progression and a coach-visible audit trail.

All three are independent and can ship in any order, but executing 1→2→3 keeps the system defensive at every layer.
