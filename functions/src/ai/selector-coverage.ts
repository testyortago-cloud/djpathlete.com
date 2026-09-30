import type { AssignedExercise, ExerciseSlot, ProgramWeek } from "./types.js"
import { verifyWithinWeekDuplicates } from "./dedup-verify.js"

/**
 * Did the exercise selector give every slot an exercise?
 *
 * Nothing used to ask. `exerciseAssignmentSchema` requires only `.min(1)`, the
 * week/day retry loop retried on DUPLICATES alone, and the save step wrote
 * whatever came back — so on 2026-09-30 a coach asked for 12 shoulder exercises,
 * the architect built 12 slots, GPT-6 Astra filled ONE, and Monday was saved with
 * one exercise and zero warnings. Reproduced on the dev clone with a
 * bodyweight-only library: 12 slots → 1 assignment, three attempts running.
 *
 * The model was obeying the prompt. The selector prompt said "every slot MUST
 * have an assignment" AND "if the library has no suitable exercise, leave the
 * slot unassigned" — the second clause is gone now, but a prompt is a request,
 * so these checks are what actually hold.
 *
 * The full-program path does not need this: `validateProgram` reports a
 * `missing_exercise` error there and its loop retries on it.
 */

export interface UnassignedSlot {
  slot_id: string
  day_of_week: number
  role: ExerciseSlot["role"]
  movement_pattern: ExerciseSlot["movement_pattern"]
  target_muscles: string[]
}

export function findUnassignedSlots(assignments: Array<{ slot_id: string }>, week: ProgramWeek): UnassignedSlot[] {
  const assigned = new Set(assignments.map((a) => a.slot_id))
  const missing: UnassignedSlot[] = []
  for (const day of week.days) {
    for (const slot of day.slots) {
      if (assigned.has(slot.slot_id)) continue
      missing.push({
        slot_id: slot.slot_id,
        day_of_week: day.day_of_week,
        role: slot.role,
        movement_pattern: slot.movement_pattern,
        target_muscles: slot.target_muscles,
      })
    }
  }
  return missing
}

/** Retry feedback for the selector. Empty string when nothing is missing. */
export function buildUnassignedSlotsFeedback(missing: UnassignedSlot[]): string {
  if (missing.length === 0) return ""
  const lines = missing.map(
    (m) => `- ${m.slot_id} (${m.role}, ${m.movement_pattern}, ${m.target_muscles.join("/") || "any muscles"})`,
  )
  return (
    `MISSING ASSIGNMENTS — ${missing.length} of the skeleton's slots have NO assignment:\n${lines.join("\n")}\n\n` +
    `Every slot MUST get exactly one exercise. Never leave a slot empty because no exercise is a perfect match: ` +
    `the library you were given is already filtered to what this athlete can do, so choose the closest available ` +
    `exercise for each slot and explain the compromise in substitution_notes.`
  )
}

/** Coach-facing warning when slots are still empty after every attempt. */
export function buildUnfilledSlotsWarning(missing: UnassignedSlot[], totalSlots: number, scopeLabel: string): string[] {
  if (missing.length === 0) return []
  const filled = totalSlots - missing.length
  return [
    `${scopeLabel} has ${filled} of the ${totalSlots} exercises it was planned with — ` +
      `${missing.length} ${missing.length === 1 ? "was" : "were"} left empty because the AI found no exercise it ` +
      `was willing to use. This usually means the client's equipment leaves very few options for this focus. ` +
      `Add the rest by hand, widen the equipment, or re-generate.`,
  ]
}

/**
 * Of two selector attempts, the one to keep: more slots filled first, then fewer
 * within-week duplicates, then the later attempt (written with the retry
 * feedback in front of it).
 *
 * Duplicates are the tie-break, not a footnote. Whatever is kept goes through
 * `dedupAssignmentsInPlace`, which swaps repeats for the best-scoring unused
 * exercise — on a small bodyweight library that is often off-focus. On the
 * 2026-09-30 fix run, keeping the last attempt (four repeats) over the one
 * before it (none) turned 8 of a shoulder day's 12 picks into calf raises and
 * jumps.
 */
export function pickMoreComplete<T extends { assignments: AssignedExercise[] }>(
  best: T | null,
  next: T,
  week: ProgramWeek,
): T {
  if (!best) return next
  const emptyNext = findUnassignedSlots(next.assignments, week).length
  const emptyBest = findUnassignedSlots(best.assignments, week).length
  if (emptyNext !== emptyBest) return emptyNext < emptyBest ? next : best
  const dupesNext = verifyWithinWeekDuplicates(next.assignments, week).issues.length
  const dupesBest = verifyWithinWeekDuplicates(best.assignments, week).issues.length
  return dupesNext <= dupesBest ? next : best
}
