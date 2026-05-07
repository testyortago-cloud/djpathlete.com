import { createServiceRoleClient } from "@/lib/supabase"
import type { ExerciseProgress } from "@/types/database"
import { resolveWeightOutcomes } from "@/lib/db/ai-outcomes"

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

/**
 * Calculate the current consecutive-day workout streak ending today (or yesterday).
 * Returns the number of consecutive days with at least one logged workout.
 */
export async function getWorkoutStreak(userId: string): Promise<number> {
  const supabase = getClient()

  // Fetch distinct dates with logged workouts, most recent first
  const { data, error } = await supabase
    .from("exercise_progress")
    .select("completed_at")
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })

  if (error || !data || data.length === 0) return 0

  // Collect unique dates (YYYY-MM-DD in local time)
  const uniqueDates = new Set<string>()
  for (const row of data) {
    if (row.completed_at) {
      const d = new Date(row.completed_at)
      uniqueDates.add(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      )
    }
  }

  const sortedDates = Array.from(uniqueDates).sort().reverse()
  if (sortedDates.length === 0) return 0

  // Start counting from today or yesterday
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`

  let streak = 0
  let checkDate: Date

  if (sortedDates[0] === todayStr) {
    checkDate = today
  } else if (sortedDates[0] === yesterdayStr) {
    checkDate = yesterday
  } else {
    return 0 // Most recent workout is older than yesterday — streak broken
  }

  // Count consecutive days backwards
  for (let i = 0; i < 365; i++) {
    const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, "0")}-${String(checkDate.getDate()).padStart(2, "0")}`
    if (uniqueDates.has(dateStr)) {
      streak++
      checkDate.setDate(checkDate.getDate() - 1)
    } else {
      break
    }
  }

  return streak
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
