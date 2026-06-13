import { createServiceRoleClient } from "@/lib/supabase"
import type { WorkoutSession } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getSession(
  userId: string,
  assignmentId: string,
  weekNumber: number,
  dayOfWeek: number,
): Promise<WorkoutSession | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("workout_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("assignment_id", assignmentId)
    .eq("week_number", weekNumber)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle()
  if (error) return null
  return (data as WorkoutSession) ?? null
}

/**
 * Find-or-create the session for a (user, assignment, week, day).
 * Never clobbers an existing row (so a completed session is not reset to
 * in_progress when the client reopens that day).
 */
export async function ensureSession(input: {
  user_id: string
  assignment_id: string
  week_number: number
  day_of_week: number
  session_date: string
}): Promise<WorkoutSession> {
  const existing = await getSession(input.user_id, input.assignment_id, input.week_number, input.day_of_week)
  if (existing) return existing

  const supabase = getClient()
  const { data, error } = await supabase
    .from("workout_sessions")
    .insert({ ...input, status: "in_progress" })
    .select()
    .single()
  if (error) {
    // Possible unique-constraint race with a concurrent open — re-read.
    const again = await getSession(input.user_id, input.assignment_id, input.week_number, input.day_of_week)
    if (again) return again
    throw error
  }
  return data as WorkoutSession
}

export async function setPrs(sessionId: string, prs: number | null): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("workout_sessions")
    .update({ prs, prs_recorded_at: prs == null ? null : new Date().toISOString() })
    .eq("id", sessionId)
  if (error) throw error
}

export async function finishSession(
  sessionId: string,
  patch: { session_rpe: number; volume_load_kg: number | null; duration_seconds: number | null },
): Promise<WorkoutSession> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("workout_sessions")
    .update({ ...patch, status: "completed", completed_at: new Date().toISOString() })
    .eq("id", sessionId)
    .select()
    .single()
  if (error) throw error
  return data as WorkoutSession
}

/** `YYYY-MM-DD` dates of completed sessions, newest first — used for streaks. */
export async function listCompletedSessionDates(userId: string): Promise<string[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("workout_sessions")
    .select("session_date, completed_at")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
  if (error || !data) return []
  return data.map((r) => r.session_date as string)
}

export async function getCompletedSessionCount(userId: string): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("workout_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "completed")
  if (error) return 0
  return count ?? 0
}
