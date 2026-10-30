// Staple exercises: a few exercises the coach wants back on a schedule (week 1, then every
// N weeks) so the client's progress on them can be tracked. Everything else in the pipeline
// works against repetition (the AVOID list, verifyWeekDiversity), so staples are exempt from
// that history, named to the selector for the weeks they are due, and put in place after the
// selector if it left one out.
import type { AssignedExercise, CompressedExercise, ProgramWeek } from "./types.js"

export interface Staple {
  exercise_id: string
  every_weeks: number
}

const ANCHOR_ROLES = new Set(["warm_up", "cool_down"])

/** The staples saved with a program's original request (programs.ai_generation_params.request). */
export function staplesFromParams(params: unknown): Staple[] {
  const list = (params as { request?: { staple_exercises?: unknown } } | null)?.request?.staple_exercises
  if (!Array.isArray(list)) return []
  return list.filter(
    (s): s is Staple => typeof s?.exercise_id === "string" && Number.isInteger(s?.every_weeks) && s.every_weeks >= 1,
  )
}

/** Week 1, then every `every_weeks` weeks after it: every 3 weeks is weeks 1, 4, 7, 10. */
export function staplesDueInWeek(staples: readonly Staple[] | null | undefined, week: number): Staple[] {
  return (staples ?? []).filter((s) => (week - 1) % s.every_weeks === 0)
}

/** The selector's instruction for the staples due this week ("" when none are). */
export function stapleNote(due: readonly Staple[], library: readonly CompressedExercise[]): string {
  const byId = new Map(library.map((e) => [e.id, e]))
  const lines = due.flatMap((s) => {
    const e = byId.get(s.exercise_id)
    return e ? [`- ${e.name} (exercise_id ${e.id})`] : []
  })
  if (lines.length === 0) return ""
  return `\n\nSTAPLE EXERCISES DUE THIS WEEK. The coach repeats these on purpose so the client's progress can be tracked. Put each one in exactly ONE working slot this week whose movement pattern fits it. They are NOT repetition and are not on any AVOID list:\n${lines.join("\n")}`
}

/**
 * Puts each due staple the selector left out into the week, replacing the exercise in one
 * working slot: the first slot planned for the staple's movement pattern, else the first one
 * aimed at one of its primary muscles. Never a warm-up or cool-down, and never another
 * staple's slot. A staple missing from `library` (blocked, banned, or filtered out for this
 * client) is not placed. Returns what it did, so the caller can log it.
 */
export function placeStaples(
  assignments: AssignedExercise[],
  week: ProgramWeek,
  due: readonly Staple[],
  library: readonly CompressedExercise[],
): { placed: string[]; unplaced: string[] } {
  const placed: string[] = []
  const unplaced: string[] = []
  const byId = new Map(library.map((e) => [e.id, e]))
  const stapleIds = new Set(due.map((s) => s.exercise_id))
  const slots = week.days.flatMap((d) => d.slots).filter((s) => !ANCHOR_ROLES.has(s.role))
  for (const staple of due) {
    if (assignments.some((a) => a.exercise_id === staple.exercise_id)) continue
    const exercise = byId.get(staple.exercise_id)
    const free = slots.filter((slot) => {
      const current = assignments.find((a) => a.slot_id === slot.slot_id)
      return !current || !stapleIds.has(current.exercise_id)
    })
    const slot = exercise
      ? (free.find((s) => exercise.movement_pattern != null && s.movement_pattern === exercise.movement_pattern) ??
        free.find((s) => s.target_muscles.some((m) => exercise.primary_muscles.includes(m))))
      : undefined
    if (!exercise || !slot) {
      unplaced.push(staple.exercise_id)
      continue
    }
    const placedAssignment: AssignedExercise = {
      slot_id: slot.slot_id,
      exercise_id: exercise.id,
      exercise_name: exercise.name,
      notes: null,
      fit: "exact",
      fit_reason: "Staple exercise the coach repeats on a schedule",
    }
    const at = assignments.findIndex((a) => a.slot_id === slot.slot_id)
    if (at >= 0) assignments[at] = placedAssignment
    else assignments.push(placedAssignment)
    placed.push(exercise.id)
  }
  return { placed, unplaced }
}

/** Prior weeks without their staples, so repeating a staple never counts as repetition. */
export function withoutStaples<T extends { assignments: AssignedExercise[] }>(
  weeks: readonly T[],
  staples: readonly Staple[],
): T[] {
  if (staples.length === 0) return [...weeks]
  const ids = new Set(staples.map((s) => s.exercise_id))
  return weeks.map((w) => ({ ...w, assignments: w.assignments.filter((a) => !ids.has(a.exercise_id)) }))
}
