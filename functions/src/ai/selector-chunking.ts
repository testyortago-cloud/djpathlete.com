// Pure helpers for per-day chunked exercise selection (2026-08-03: a 60-slot
// single-call selector burned all 3 attempts and the 450s budget for a new
// client's first week; the owner's manual "one day at a time" retry succeeded
// in ~2 minutes — so the orchestrator now does that split itself). Leaf module:
// no firebase, no anthropic, unit-testable in isolation.
import type { ExerciseAssignment } from "./types.js"

/** Above this many slots, the selector runs one day per call instead of the
 *  whole week in one shot. 25 keeps typical 3-4 day weeks single-call (cheap,
 *  cache-friendly) while splitting the 5-6 day × 10-12 slot programs that
 *  actually blow the budget. */
export const SELECTOR_CHUNK_THRESHOLD = 25

export function shouldChunkSelector(totalSlots: number, dayCount: number, isSingleDay: boolean): boolean {
  return !isSingleDay && dayCount > 1 && totalSlots > SELECTOR_CHUNK_THRESHOLD
}

const DAY_LABELS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const

export function dayLabel(dayOfWeek: number): string {
  return DAY_LABELS[dayOfWeek] ?? `Day ${dayOfWeek}`
}

/** Skeleton narrowed to ONE day of week 0 — the JSON the selector sees for a
 *  chunk. Week-level metadata (phase, notes, total_sessions) rides along so
 *  the selector keeps the same context it had in single-shot mode. */
export function dayScopedSkeleton<S extends { weeks: W[] }, W extends { days: D[] }, D>(
  skeleton: S,
  day: D,
): S {
  const week0 = skeleton.weeks[0]
  return { ...skeleton, weeks: [{ ...week0, days: [day] }, ...skeleton.weeks.slice(1)] }
}

export interface PickedExercise {
  exercise_id: string
  exercise_name: string | null
  day_of_week: number
}

/** Prompt section carrying earlier chunks' picks into later chunks, so
 *  cross-day variety survives the split. Empty string for the first chunk. */
export function buildAlreadySelectedSection(picked: PickedExercise[]): string {
  if (picked.length === 0) return ""
  const lines = picked.map(
    (p) => `- ${p.exercise_name ?? "exercise"} (${p.exercise_id}) — ${dayLabel(p.day_of_week)}`,
  )
  return (
    `\n\nALREADY SELECTED THIS WEEK (earlier days of the SAME week — working slots must NOT reuse these exercise_ids; warm-up/cool-down may):\n` +
    lines.join("\n")
  )
}

/**
 * How many days may be selected concurrently after the first. 6 covers a whole
 * training week in one round, so a 6-day week costs two rounds rather than
 * three — measured 267s at 6 vs 325s at 4 on the same shape, with no rate
 * limiting across three runs. Still bounded: every day is a large model call,
 * and too many at once trades a timeout for 429s, which `callAgent`'s retry
 * then pays for in the wall-clock we were trying to save.
 *
 * Tunable per-environment via the `ai_day_selection_concurrency` system
 * setting — lower it if the shared Anthropic quota starts returning 429s.
 */
export const DEFAULT_DAY_CONCURRENCY = 6

/**
 * Groups day indexes into the rounds they should run in.
 *
 * The first day always runs on its own. Two reasons, both load-bearing:
 * writing the shared prompt-cache prefix once means every later day reads it
 * instead of paying for its own cache write, and the first day's picks seed the
 * "already selected this week" AVOID list the parallel days share. The rest run
 * `concurrency` at a time.
 *
 * Sequential selection is what made a 6-day week miss its 450s budget on
 * 2026-08-31 (Lea J Athlete, week 4, died on day 4 of 6).
 */
export function planDayBatches(dayCount: number, concurrency: number): number[][] {
  if (dayCount <= 0) return []
  const batches: number[][] = [[0]]
  const step = Math.max(1, concurrency)
  for (let i = 1; i < dayCount; i += step) {
    batches.push(Array.from({ length: Math.min(step, dayCount - i) }, (_, k) => i + k))
  }
  return batches
}

/** Concatenate per-day results into one week-shaped assignment. */
export function mergeAssignments(chunks: ExerciseAssignment[]): ExerciseAssignment {
  return {
    assignments: chunks.flatMap((c) => c.assignments),
    substitution_notes: chunks.flatMap((c) => c.substitution_notes),
  }
}
