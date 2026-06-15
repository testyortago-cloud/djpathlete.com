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
  assessment: Omit<PerformanceAssessment, "id" | "created_at" | "updated_at">,
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("performance_assessments").insert(assessment).select().single()
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

export async function getAllPerformanceAssessments(filters?: { status?: PerformanceAssessmentStatus }) {
  const supabase = getClient()
  let query = supabase
    .from("performance_assessments")
    .select("*, users!performance_assessments_client_user_id_fkey(first_name, last_name, email)")
    .eq("is_template", false)
    .order("created_at", { ascending: false })

  if (filters?.status) {
    query = query.eq("status", filters.status)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

/** Reusable assessment templates (no specific client), newest first, with exercise count. */
export async function listAssessmentTemplates() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_assessments")
    .select("*, performance_assessment_exercises(count)")
    .eq("is_template", true)
    .order("created_at", { ascending: false })
  if (error) throw error
  return data
}

/**
 * Copy a template into a new draft assessment for a specific client (deep-copies
 * the template's exercises). Returns the new assessment.
 */
export async function createAssessmentFromTemplate(templateId: string, clientUserId: string, adminId: string) {
  const template = (await getPerformanceAssessmentById(templateId)) as PerformanceAssessment | null
  if (!template || !template.is_template) throw new Error("Not a template")

  const assessment = await createPerformanceAssessment({
    client_user_id: clientUserId,
    created_by: adminId,
    title: template.title,
    notes: template.notes,
    status: "draft",
    is_template: false,
    template_name: null,
  })

  const templateExercises = await getAssessmentExercises(templateId)
  if (templateExercises.length > 0) {
    await createAssessmentExercises(
      templateExercises.map((ex, i) => ({
        assessment_id: assessment.id,
        exercise_id: ex.exercise_id,
        custom_name: ex.custom_name,
        youtube_url: ex.youtube_url,
        video_path: null,
        admin_notes: ex.admin_notes,
        result_value: null,
        result_unit: ex.result_unit,
        order_index: ex.order_index ?? i,
      })),
    )
  }

  return assessment
}

export async function updatePerformanceAssessment(
  id: string,
  updates: Partial<Pick<PerformanceAssessment, "status" | "title" | "notes">>,
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("performance_assessments").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as PerformanceAssessment
}

export async function deletePerformanceAssessment(id: string) {
  const supabase = getClient()
  const { error } = await supabase.from("performance_assessments").delete().eq("id", id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Assessment Exercises
// ---------------------------------------------------------------------------

export async function createAssessmentExercises(
  exercises: Omit<PerformanceAssessmentExercise, "id" | "created_at" | "updated_at">[],
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("performance_assessment_exercises").insert(exercises).select()
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
  updates: Partial<
    Pick<PerformanceAssessmentExercise, "video_path" | "admin_notes" | "youtube_url" | "result_value" | "result_unit">
  >,
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
  exercise: Omit<PerformanceAssessmentExercise, "id" | "created_at" | "updated_at">,
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
  const { error } = await supabase.from("performance_assessment_exercises").delete().eq("id", id)
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

export async function createAssessmentMessage(message: Omit<PerformanceAssessmentMessage, "id" | "created_at">) {
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
// Exercise Result History (for progress tracking)
// ---------------------------------------------------------------------------

export async function getExerciseResultHistory(
  clientUserId: string,
  exerciseIdentifier: { exercise_id?: string; custom_name?: string },
) {
  const supabase = getClient()
  let query = supabase
    .from("performance_assessment_exercises")
    .select(
      `
      id,
      result_value,
      result_unit,
      custom_name,
      exercise_id,
      exercises(id, name),
      assessment_id,
      performance_assessments!inner(id, title, created_at, client_user_id, status)
    `,
    )
    .eq("performance_assessments.client_user_id", clientUserId)
    .neq("performance_assessments.status", "draft")
    .not("result_value", "is", null)
    .order("created_at", { ascending: true })

  if (exerciseIdentifier.exercise_id) {
    query = query.eq("exercise_id", exerciseIdentifier.exercise_id)
  } else if (exerciseIdentifier.custom_name) {
    query = query.eq("custom_name", exerciseIdentifier.custom_name)
  }

  const { data, error } = await query
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
    .eq("is_template", false)
  if (error) throw error

  const counts = { draft: 0, in_progress: 0, completed: 0, total: 0 }
  for (const row of data ?? []) {
    counts[row.status as PerformanceAssessmentStatus]++
    counts.total++
  }
  return counts
}
