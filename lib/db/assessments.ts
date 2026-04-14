import { createServiceRoleClient } from "@/lib/supabase"
import type { AssessmentQuestion, AssessmentResult, AssessmentSection } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

// ─── Assessment Questions ────────────────────────────────────────────────────

/** Get all active questions ordered by section and order_index */
export async function getActiveQuestions() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("assessment_questions")
    .select("*")
    .eq("is_active", true)
    .order("section", { ascending: true })
    .order("order_index", { ascending: true })
  if (error) throw error
  return data as AssessmentQuestion[]
}

/** Get active questions for a specific section */
export async function getQuestionsBySection(section: AssessmentSection) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("assessment_questions")
    .select("*")
    .eq("section", section)
    .eq("is_active", true)
    .order("order_index", { ascending: true })
  if (error) throw error
  return data as AssessmentQuestion[]
}

/** Get all questions including inactive (admin view) */
export async function getAllQuestions() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("assessment_questions")
    .select("*")
    .order("section", { ascending: true })
    .order("order_index", { ascending: true })
  if (error) throw error
  return data as AssessmentQuestion[]
}

/** Create a new assessment question */
export async function createQuestion(question: Omit<AssessmentQuestion, "id" | "created_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("assessment_questions").insert(question).select().single()
  if (error) throw error
  return data as AssessmentQuestion
}

/** Update an assessment question */
export async function updateQuestion(id: string, updates: Partial<Omit<AssessmentQuestion, "id" | "created_at">>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("assessment_questions").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as AssessmentQuestion
}

/** Soft delete a question (set is_active = false) */
export async function deleteQuestion(id: string) {
  const supabase = getClient()
  const { error } = await supabase.from("assessment_questions").update({ is_active: false }).eq("id", id)
  if (error) throw error
}

/** Batch reorder questions */
export async function reorderQuestions(updates: { id: string; order_index: number }[]) {
  const supabase = getClient()
  // Update each question's order_index individually
  for (const update of updates) {
    const { error } = await supabase
      .from("assessment_questions")
      .update({ order_index: update.order_index })
      .eq("id", update.id)
    if (error) throw error
  }
}

// ─── Assessment Results ──────────────────────────────────────────────────────

/** Get a single assessment result by ID */
export async function getAssessmentResult(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("assessment_results").select("*").eq("id", id).single()
  if (error) throw error
  return data as AssessmentResult
}

/** Get all assessment results for a user */
export async function getAssessmentResultsByUser(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("assessment_results")
    .select("*")
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
  if (error) throw error
  return data as AssessmentResult[]
}

/** Get the most recent assessment result for a user */
export async function getLatestAssessmentResult(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("assessment_results")
    .select("*")
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as AssessmentResult | null
}

/** Save a new assessment result */
export async function createAssessmentResult(result: Omit<AssessmentResult, "id" | "created_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("assessment_results").insert(result).select().single()
  if (error) throw error
  return data as AssessmentResult
}

/** Update an assessment result (e.g., link triggered_program_id) */
export async function updateAssessmentResult(
  id: string,
  updates: Partial<Omit<AssessmentResult, "id" | "created_at">>,
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("assessment_results").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as AssessmentResult
}

/** Get all assessment results (admin view) with optional pagination */
export async function getAllAssessmentResults() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("assessment_results")
    .select("*")
    .order("completed_at", { ascending: false })
  if (error) throw error
  return data as AssessmentResult[]
}
