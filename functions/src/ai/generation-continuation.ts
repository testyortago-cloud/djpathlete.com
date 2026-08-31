/**
 * Splitting one program generation across several function invocations.
 *
 * Why this exists: event-triggered gen2 functions are hard-capped at 540s (see
 * the comment above `weekGeneration` in index.ts), and a program is generated
 * one week at a time — each week carries the previous weeks in its prompt so
 * the selector can avoid repeating exercises, so the weeks cannot run in
 * parallel. At the ~2-4 min per week this pipeline actually costs, anything
 * past ~3 weeks cannot finish inside a single invocation, and a 12-week program
 * never could. Before this module, such a run was hard-killed mid-flight and
 * every completed week was discarded, because the program row was only written
 * after the LAST week.
 *
 * Now the orchestrator commits each finished week as it lands and hands the
 * weeks it did not reach to the existing `week_generation` job type, which
 * chains itself one week per invocation (see on-ai-job-completed.ts). Each link
 * gets a fresh 540s and reads the prior weeks back out of the database, so the
 * dedup context survives the handoff.
 */

/** Wall-clock held back for the partial-finish writes (program + log + enqueue). */
export const FINISH_RESERVE_MS = 30_000

/**
 * Later weeks run slower than earlier ones: each carries more prior-week context
 * in its prompt and has a harder dedup constraint to satisfy. Budgeting off the
 * slowest week seen so far, plus this margin, keeps the estimate honest.
 */
const SLOWDOWN_MARGIN = 1.25

/**
 * Hard ceiling on how many links a single chain may add, independent of what
 * `final_week` claims. A corrupt or hand-edited job doc must not be able to
 * queue an unbounded run of paid model calls.
 */
export const MAX_CONTINUATION_WEEKS = 52

/**
 * Is there time to generate one more week before the budget is spent?
 *
 * @param remainingMs             What the Deadline has left.
 * @param observedWeekDurationsMs How long each week of THIS run actually took.
 */
export function canFitAnotherWeek(
  remainingMs: number,
  observedWeekDurationsMs: readonly number[],
  reserveMs: number = FINISH_RESERVE_MS,
): boolean {
  // Nothing measured yet, so there is nothing to estimate from. The first week
  // always runs: refusing it would return an empty program AND leave no
  // committed week to continue from, which is strictly worse than trying.
  if (observedWeekDurationsMs.length === 0) return true
  const slowest = Math.max(...observedWeekDurationsMs)
  return remainingMs >= slowest * SLOWDOWN_MARGIN + reserveMs
}

export interface ContinuationMeta {
  /** Last week the architect planned. The chain stops after this one. */
  final_week: number
  origin: "program_generation"
  origin_job_id?: string | null
  origin_log_id?: string | null
  /**
   * Where to send the one "your program is ready" email, carried here rather
   * than on the job's own `notify_email` because that field is the per-job
   * "should THIS link send" flag and is nulled on every intermediate week. An
   * address kept only there would be erased by the first link and never reach
   * the last one.
   */
  notify_email?: string | null
}

/** The subset of the original generation request a continuation week needs. */
export interface WeekContinuationSeed {
  program_id: string
  client_id?: string | null
  admin_instructions?: string | null
  pool_exercise_ids?: string[] | null
  pool_mode?: "preferred" | "strict"
  ignore_profile?: boolean
}

/**
 * Mirrors exactly what the /api/admin/programs/[id]/generate-week route writes,
 * nulls included. Firestore rejects `undefined` as a field value, so every
 * optional field is an explicit null here rather than an omission.
 */
export interface WeekContinuationRequest {
  program_id: string
  assignment_id: string | null
  client_id: string | null
  admin_instructions: string | null
  target_week_number: number
  target_day_of_week: null
  pool_exercise_ids: string[] | null
  pool_mode: "preferred" | "strict"
  ignore_profile: boolean
}

export interface WeekContinuationInput {
  request: WeekContinuationRequest
  requestedBy: string
  notify_email: string | null
  continuation: ContinuationMeta
}

/**
 * Which week the chain should generate next, or null when it is finished.
 * Returns null rather than throwing — a chain that cannot identify its next
 * step must stop quietly, not crash the completion trigger.
 */
export function nextContinuationWeek(
  completedWeek: number | undefined | null,
  continuation: ContinuationMeta,
): number | null {
  if (typeof completedWeek !== "number" || !Number.isFinite(completedWeek)) return null
  const next = completedWeek + 1
  if (next > continuation.final_week) return null
  if (next > MAX_CONTINUATION_WEEKS) return null
  return next
}

export function buildWeekContinuationInput(
  seed: WeekContinuationSeed,
  targetWeek: number,
  continuation: ContinuationMeta,
  requestedBy: string,
): WeekContinuationInput {
  // Only the last week emails. Every intermediate week completing is an
  // implementation detail of one program the coach asked for once.
  const isFinalWeek = targetWeek >= continuation.final_week

  return {
    request: {
      program_id: seed.program_id,
      assignment_id: null,
      client_id: seed.client_id ?? null,
      admin_instructions: seed.admin_instructions ?? null,
      target_week_number: targetWeek,
      // Load-bearing: a day-scoped continuation would fill one day and leave
      // the rest of that week blank with no further link to fill it.
      target_day_of_week: null,
      pool_exercise_ids: seed.pool_exercise_ids ?? null,
      pool_mode: seed.pool_mode ?? "preferred",
      ignore_profile: seed.ignore_profile ?? false,
    },
    requestedBy,
    notify_email: isFinalWeek ? (continuation.notify_email ?? null) : null,
    continuation,
  }
}
