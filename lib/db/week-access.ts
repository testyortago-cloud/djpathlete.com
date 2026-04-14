import { createServiceRoleClient } from "@/lib/supabase"
import type { ProgramWeekAccess } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

/** Get all week access records for an assignment */
export async function getWeekAccessByAssignment(assignmentId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_week_access")
    .select("*")
    .eq("assignment_id", assignmentId)
    .order("week_number", { ascending: true })
  if (error) throw error
  return (data ?? []) as ProgramWeekAccess[]
}

/** Get all week access records for multiple assignments (batch) */
export async function getWeekAccessByAssignments(assignmentIds: string[]) {
  if (assignmentIds.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_week_access")
    .select("*")
    .in("assignment_id", assignmentIds)
    .order("week_number", { ascending: true })
  if (error) throw error
  return (data ?? []) as ProgramWeekAccess[]
}

/** Get a specific week access record */
export async function getWeekAccess(assignmentId: string, weekNumber: number) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_week_access")
    .select("*")
    .eq("assignment_id", assignmentId)
    .eq("week_number", weekNumber)
    .maybeSingle()
  if (error) throw error
  return data as ProgramWeekAccess | null
}

/** Get a week access record by ID */
export async function getWeekAccessById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("program_week_access").select("*").eq("id", id).single()
  if (error) throw error
  return data as ProgramWeekAccess
}

/** Create a week access record */
export async function createWeekAccess(record: Omit<ProgramWeekAccess, "id" | "created_at" | "updated_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("program_week_access").insert(record).select().single()
  if (error) throw error
  return data as ProgramWeekAccess
}

/** Bulk-create week access records (e.g., on initial assignment) */
export async function createWeekAccessBulk(records: Omit<ProgramWeekAccess, "id" | "created_at" | "updated_at">[]) {
  if (records.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase.from("program_week_access").insert(records).select()
  if (error) throw error
  return (data ?? []) as ProgramWeekAccess[]
}

/** Update a week access record */
export async function updateWeekAccess(
  id: string,
  updates: Partial<
    Pick<
      ProgramWeekAccess,
      "access_type" | "price_cents" | "payment_status" | "stripe_session_id" | "stripe_payment_id"
    >
  >,
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("program_week_access").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as ProgramWeekAccess
}

/** Update week access by assignment + week number */
export async function updateWeekAccessByAssignmentAndWeek(
  assignmentId: string,
  weekNumber: number,
  updates: Partial<
    Pick<
      ProgramWeekAccess,
      "access_type" | "price_cents" | "payment_status" | "stripe_session_id" | "stripe_payment_id"
    >
  >,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_week_access")
    .update(updates)
    .eq("assignment_id", assignmentId)
    .eq("week_number", weekNumber)
    .select()
    .single()
  if (error) throw error
  return data as ProgramWeekAccess
}

/** Delete week access records for a specific week (when a week is deleted from program) */
export async function deleteWeekAccessForWeek(assignmentId: string, weekNumber: number) {
  const supabase = getClient()
  const { error } = await supabase
    .from("program_week_access")
    .delete()
    .eq("assignment_id", assignmentId)
    .eq("week_number", weekNumber)
  if (error) throw error
}

/** Shift week numbers down after a week is deleted (mirrors program_exercises shift) */
export async function shiftWeekAccessDown(assignmentId: string, afterWeekNumber: number) {
  const supabase = getClient()
  const { data: later, error: fetchError } = await supabase
    .from("program_week_access")
    .select("id, week_number")
    .eq("assignment_id", assignmentId)
    .gt("week_number", afterWeekNumber)
  if (fetchError) throw fetchError

  if (later && later.length > 0) {
    await Promise.all(
      later.map((row: { id: string; week_number: number }) =>
        supabase
          .from("program_week_access")
          .update({ week_number: row.week_number - 1 })
          .eq("id", row.id),
      ),
    )
  }
}
