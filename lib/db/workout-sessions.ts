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

/** `"week-day"` keys of completed sessions for one assignment (program progress). */
export async function listCompletedDayKeys(userId: string, assignmentId: string): Promise<string[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("workout_sessions")
    .select("week_number, day_of_week")
    .eq("user_id", userId)
    .eq("assignment_id", assignmentId)
    .eq("status", "completed")
  if (error || !data) return []
  return (data as { week_number: number; day_of_week: number }[]).map((r) => `${r.week_number}-${r.day_of_week}`)
}

/**
 * True when any completed workout session exists for (user, assignment, date).
 * Day guard for the hybrid attendance advance: errors return true so a flaky
 * read can only SKIP an advance, never double it.
 */
export async function hasCompletedOnDate(userId: string, assignmentId: string, sessionDate: string): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("workout_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("assignment_id", assignmentId)
    .eq("session_date", sessionDate)
    .eq("status", "completed")
    .limit(1)
  if (error) return true
  return (data ?? []).length > 0
}

/** Mark a session completed from an in-person check-in (no metric entry required). */
export async function completeForCheckin(sessionId: string, note: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("workout_sessions")
    .update({ status: "completed", completed_at: new Date().toISOString(), notes: note })
    .eq("id", sessionId)
  if (error) throw error
}

/** Reopen a session when its in-person check-in is voided. */
export async function reopenForVoid(sessionId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("workout_sessions")
    .update({ status: "in_progress", completed_at: null, session_rpe: null, volume_load_kg: null })
    .eq("id", sessionId)
  if (error) throw error
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
