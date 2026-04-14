import { createServiceRoleClient } from "@/lib/supabase"
import type { AssessmentQuestion, AssessmentResult } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

/* ─── Assessment Questions ───────────────────────────────────────── */

export async function getAssessmentQuestions(activeOnly = false) {
  const supabase = getClient()
  let query = supabase
    .from("assessment_questions")
    .select("*")
    .order("section")
    .order("order_index", { ascending: true })

  if (activeOnly) {
    query = query.eq("is_active", true)
  }

  const { data, error } = await query
  if (error) throw error
  return data as AssessmentQuestion[]
}

export async function getAssessmentQuestionById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("assessment_questions").select("*").eq("id", id).single()
  if (error) throw error
  return data as AssessmentQuestion
}

export async function createAssessmentQuestion(question: Omit<AssessmentQuestion, "id" | "created_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("assessment_questions").insert(question).select().single()
  if (error) throw error
  return data as AssessmentQuestion
}

export async function updateAssessmentQuestion(
  id: string,
  updates: Partial<Omit<AssessmentQuestion, "id" | "created_at">>,
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("assessment_questions").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as AssessmentQuestion
}

export async function deleteAssessmentQuestion(id: string) {
  const supabase = getClient()
  const { error } = await supabase.from("assessment_questions").delete().eq("id", id)
  if (error) throw error
}

/* ─── Assessment Results ─────────────────────────────────────────── */

export async function getAssessmentResults(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("assessment_results")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as AssessmentResult[]
}

export async function createAssessmentResult(result: Omit<AssessmentResult, "id" | "created_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("assessment_results").insert(result).select().single()
  if (error) throw error
  return data as AssessmentResult
}

export async function getLatestAssessmentResult(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("assessment_results")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as AssessmentResult | null
}
