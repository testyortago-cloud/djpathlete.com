import type { AssignedExercise, ProgramWeek } from "./types.js"

/**
 * Substitutes the coach should know about (2026-10-04). The selector must fill
 * every slot, so when the library runs out it fills a squat slot with whatever
 * is left — 27 of 72 slots on 2026-08-31, with every check green. The model now
 * labels each pick; code does not trust the label and re-checks the pattern.
 * Shown to the coach, never rebuilt (owner decision).
 */
export interface SlotFitItem {
  day_of_week: number
  slot_role: string
  slot_pattern: string
  exercise_name: string
  reason: string
}

/** Roles where crossing patterns is normal (jumps, throws, drills) or irrelevant. */
const PATTERN_FREE_ROLES = new Set(["warm_up", "cool_down", "power", "conditioning", "activation"])

const COMPATIBLE: string[][] = [
  ["squat", "lunge"],
  ["isometric", "rotation", "carry"],
  ["locomotion", "conditioning"],
]
// ponytail: hand-written compatibility groups; replace with library co-occurrence data if they prove noisy.

function compatible(a: string, b: string): boolean {
  return a === b || COMPATIBLE.some((g) => g.includes(a) && g.includes(b))
}

export function gradeFits(
  weeks: ProgramWeek[],
  assignments: AssignedExercise[],
  library: Array<{ id: string; name: string; movement_pattern?: string | null }>,
): SlotFitItem[] {
  const byId = new Map(library.map((e) => [e.id, e]))
  const bySlot = new Map(assignments.map((a) => [a.slot_id, a]))
  const out: SlotFitItem[] = []
  for (const week of weeks)
    for (const day of week.days)
      for (const slot of day.slots) {
        const a = bySlot.get(slot.slot_id)
        const ex = a ? byId.get(a.exercise_id) : undefined
        if (!a || !ex) continue
        const mismatch =
          !PATTERN_FREE_ROLES.has(slot.role) &&
          !!ex.movement_pattern &&
          !compatible(ex.movement_pattern, slot.movement_pattern)
        if (!mismatch && a.fit !== "poor") continue
        const reason =
          a.fit_reason?.trim() ||
          (mismatch
            ? `${ex.movement_pattern} exercise in a ${slot.movement_pattern} slot`
            : "the AI marked this a poor match")
        out.push({
          day_of_week: day.day_of_week,
          slot_role: slot.role,
          slot_pattern: slot.movement_pattern,
          exercise_name: ex.name,
          reason,
        })
      }
  return out
}
