import { createServiceRoleClient } from "@/lib/supabase"
import type { ExerciseProgress } from "@/types/database"
import { resolveWeightOutcomes } from "@/lib/db/ai-outcomes"
import { listCompletedSessionDates } from "@/lib/db/workout-sessions"
import { streakFromDates } from "@/lib/workout/streak"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getProgress(userId: string, exerciseId?: string) {
  const supabase = getClient()
  let query = supabase
    .from("exercise_progress")
    .select("*, exercises(*)")
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
  if (exerciseId) {
    query = query.eq("exercise_id", exerciseId)
  }
  const { data, error } = await query
  if (error) throw error
  return data
}

/**
 * Batch-fetch latest progress entries for multiple exercises at once.
 * Returns a map of exerciseId → ExerciseProgress[] (newest first, up to `limit` per exercise).
 */
export async function getLatestProgressByExercises(
  userId: string,
  exerciseIds: string[],
  limit = 5,
): Promise<Record<string, ExerciseProgress[]>> {
  if (exerciseIds.length === 0) return {}

  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_progress")
    .select("*")
    .eq("user_id", userId)
    .in("exercise_id", exerciseIds)
    .order("completed_at", { ascending: false })

  if (error) throw error

  // Group by exercise_id and take latest N per exercise
  const grouped: Record<string, ExerciseProgress[]> = {}
  for (const row of (data ?? []) as ExerciseProgress[]) {
    const eid = row.exercise_id
    if (!grouped[eid]) grouped[eid] = []
    if (grouped[eid].length < limit) {
      grouped[eid].push(row)
    }
  }

  return grouped
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * Current workout streak = consecutive days ending today/yesterday on which the
 * client COMPLETED a workout session (a real finished workout, not just logging
 * one exercise).
 *
 * Legacy fallback: clients with no completed sessions yet (this feature is new)
 * keep the old "days with a logged exercise" count so their existing streak
 * doesn't reset to 0 on ship. They migrate to session-based automatically once
 * they finish their first session.
 */
export async function getWorkoutStreak(userId: string): Promise<number> {
  const today = new Date()
  const todayStr = ymdLocal(today)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = ymdLocal(yesterday)

  // Preferred: completed workout sessions.
  const sessionDates = await listCompletedSessionDates(userId)
  if (sessionDates.length > 0) {
    return streakFromDates(sessionDates, todayStr, yesterdayStr)
  }

  // Legacy fallback: days with at least one logged exercise.
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_progress")
    .select("completed_at")
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
  if (error || !data || data.length === 0) return 0

  const dates = data
    .map((r) => (r.completed_at ? ymdLocal(new Date(r.completed_at)) : null))
    .filter((d): d is string => d != null)
  return streakFromDates(dates, todayStr, yesterdayStr)
}

/**
 * Get recent progress for exercises with the same movement pattern,
 * excluding a specific exercise. Used for cross-exercise intelligence
 * when a client has no history for a particular exercise.
 */
export async function getRelatedProgressByPattern(
  userId: string,
  movementPattern: string,
  excludeExerciseId: string,
  limit = 9,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_progress")
    .select("*, exercises!inner(name, movement_pattern)")
    .eq("user_id", userId)
    .eq("exercises.movement_pattern", movementPattern)
    .neq("exercise_id", excludeExerciseId)
    .order("completed_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as (ExerciseProgress & { exercises: { name: string; movement_pattern: string } })[]
}

export async function getProgressByAssignment(userId: string, assignmentId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_progress")
    .select("*, exercises(*)")
    .eq("user_id", userId)
    .eq("assignment_id", assignmentId)
    .order("completed_at", { ascending: false })
  if (error) throw error
  return data
}

export async function getAllProgress(limit?: number) {
  const supabase = getClient()
  let query = supabase
    .from("exercise_progress")
    .select("*, exercises(name)")
    .order("completed_at", { ascending: false })
  if (limit) query = query.limit(limit)
  const { data, error } = await query
  if (error) throw error
  return data as (ExerciseProgress & { exercises: { name: string } | null })[]
}

/**
 * Returns clients whose most recent exercise_progress is older than `since`,
 * limited to clients with at least one prior log (cold leads excluded).
 * Uses the clients_without_log_since RPC for performance.
 */
export async function listClientsWithoutLogSince(
  since: Date,
): Promise<Array<{ id: string; first_name: string | null; last_name: string | null; days_since_last_log: number }>> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("clients_without_log_since", {
    p_since: since.toISOString(),
  })
  if (error) throw error
  return (data ?? []) as Array<{
    id: string
    first_name: string | null
    last_name: string | null
    days_since_last_log: number
  }>
}

export async function countSessionsInRange(from: Date, to: Date): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("exercise_progress")
    .select("id", { head: true, count: "exact" })
    .gte("completed_at", from.toISOString())
    .lt("completed_at", to.toISOString())
  if (error) throw error
  return count ?? 0
}

export async function countActiveClientsInRange(from: Date, to: Date): Promise<number> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_progress")
    .select("user_id")
    .gte("completed_at", from.toISOString())
    .lt("completed_at", to.toISOString())
  if (error) throw error
  const uniq = new Set((data ?? []).map((r) => (r as { user_id: string }).user_id))
  return uniq.size
}

export async function logProgress(progress: Omit<ExerciseProgress, "id" | "created_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("exercise_progress").insert(progress).select().single()
  if (error) throw error

  const result = data as ExerciseProgress

  // Resolve any pending AI weight predictions for this exercise (fire-and-forget)
  if (result.weight_kg != null) {
    resolveWeightOutcomes(result.user_id, result.exercise_id, result.weight_kg).catch(() => {})
  }

  return result
}
