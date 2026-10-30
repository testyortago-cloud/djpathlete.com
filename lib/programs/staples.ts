// Staple exercises: the few exercises an AI-generated program brings back on a schedule so the
// client's progress on them can be tracked. The coach picks them in the generate dialog, and they
// are saved with the program's request (programs.ai_generation_params.request.staple_exercises).

export interface Staple {
  exercise_id: string
  every_weeks: number
}

/**
 * The staples saved with a program's original request, or [] for any program without them.
 * TWIN: staplesFromParams in functions/src/ai/staples.ts (functions/ cannot import lib/).
 */
export function staplesFromParams(params: unknown): Staple[] {
  const list = (params as { request?: { staple_exercises?: unknown } } | null)?.request?.staple_exercises
  if (!Array.isArray(list)) return []
  return list.filter(
    (s): s is Staple => typeof s?.exercise_id === "string" && Number.isInteger(s?.every_weeks) && s.every_weeks >= 1,
  )
}

export interface KeyLift {
  exerciseId: string
  exerciseName: string
  staple: boolean
}

/**
 * The lifts on the client's Progress page, each exercise once: the program's staples first (the
 * coach picked them so the client has a few lifts to watch), then the ones the client tracks.
 * `programNames` holds the names of the exercises in the program; a staple that is not in it
 * (never placed, or since removed by the coach) is left out, because the client cannot log it.
 */
export function keyLiftExercises(
  staples: readonly Staple[],
  programNames: ReadonlyMap<string, string>,
  tracked: readonly { exerciseId: string; exerciseName: string }[],
): KeyLift[] {
  const lifts: KeyLift[] = [
    ...staples.flatMap((s) => {
      const exerciseName = programNames.get(s.exercise_id)
      return exerciseName ? [{ exerciseId: s.exercise_id, exerciseName, staple: true }] : []
    }),
    ...tracked.map((t) => ({ ...t, staple: false })),
  ]
  return lifts.filter((l, i) => lifts.findIndex((o) => o.exerciseId === l.exerciseId) === i)
}
