import { createServiceRoleClient } from "@/lib/supabase"
import type {
  PerformanceAssessment,
  PerformanceAssessmentExercise,
  PerformanceAssessmentMessage,
  PerformanceAssessmentStatus,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

export async function createPerformanceAssessment(
  assessment: Omit<PerformanceAssessment, "id" | "created_at" | "updated_at">
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_assessments")
    .insert(assessment)
    .select()
    .single()
  if (error) throw error
  return data as PerformanceAssessment
}

export async function getPerformanceAssessmentById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_assessments")
    .select("*, users!performance_assessments_client_user_id_fkey(id, first_name, last_name, email, avatar_url)")
    .eq("id", id)
    .single()
  if (error) throw error
  return data
}

export async function getPerformanceAssessmentsByClient(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_assessments")
    .select("*")
    .eq("client_user_id", userId)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
  if (error) throw error
  return data
}

export async function getAllPerformanceAssessments(filters?: {
  status?: PerformanceAssessmentStatus
}) {
  const supabase = getClient()
  let query = supabase
    .from("performance_assessments")
    .select("*, users!performance_assessments_client_user_id_fkey(first_name, last_name, email)")
    .order("created_at", { ascending: false })

  if (filters?.status) {
    query = query.eq("status", filters.status)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function updatePerformanceAssessment(
  id: string,
  updates: Partial<Pick<PerformanceAssessment, "status" | "title" | "notes">>
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_assessments")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as PerformanceAssessment
}

// ---------------------------------------------------------------------------
// Assessment Exercises
// ---------------------------------------------------------------------------

export async function createAssessmentExercises(
  exercises: Omit<PerformanceAssessmentExercise, "id" | "created_at" | "updated_at">[]
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_assessment_exercises")
    .insert(exercises)
    .select()
  if (error) throw error
  return data as PerformanceAssessmentExercise[]
}

export async function getAssessmentExercises(assessmentId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_assessment_exercises")
    .select("*, exercises(id, name)")
    .eq("assessment_id", assessmentId)
    .order("order_index", { ascending: true })
  if (error) throw error
  return data
}

export async function updateAssessmentExercise(
  id: string,
  updates: Partial<Pick<PerformanceAssessmentExercise, "video_path" | "admin_notes" | "youtube_url">>
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_assessment_exercises")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as PerformanceAssessmentExercise
}

export async function addAssessmentExercise(
  exercise: Omit<PerformanceAssessmentExercise, "id" | "created_at" | "updated_at">
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_assessment_exercises")
    .insert(exercise)
    .select("*, exercises(id, name)")
    .single()
  if (error) throw error
  return data
}

export async function deleteAssessmentExercise(id: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("performance_assessment_exercises")
    .delete()
    .eq("id", id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function getAssessmentMessages(assessmentExerciseId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_assessment_messages")
    .select("*, users(first_name, last_name, avatar_url, role)")
    .eq("assessment_exercise_id", assessmentExerciseId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return data
}

export async function createAssessmentMessage(
  message: Omit<PerformanceAssessmentMessage, "id" | "created_at">
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_assessment_messages")
    .insert(message)
    .select("*, users(first_name, last_name, avatar_url, role)")
    .single()
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// Counts (for admin badge)
// ---------------------------------------------------------------------------

export async function getPerformanceAssessmentCounts() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_assessments")
    .select("status")
  if (error) throw error

  const counts = { draft: 0, in_progress: 0, completed: 0, total: 0 }
  for (const row of data ?? []) {
    counts[row.status as PerformanceAssessmentStatus]++
    counts.total++
  }
  return counts
}
