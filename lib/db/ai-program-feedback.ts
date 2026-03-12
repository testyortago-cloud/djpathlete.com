import { createServiceRoleClient } from "@/lib/supabase"
import type { AiProgramFeedback } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

// ─── Upsert ──────────────────────────────────────────────────────────────────

export async function submitProgramFeedback(
  data: Omit<AiProgramFeedback, "id" | "embedding" | "created_at" | "updated_at">
) {
  const supabase = getClient()
  const { data: result, error } = await supabase
    .from("ai_program_feedback")
    .upsert(data, { onConflict: "program_id,reviewer_id" })
    .select()
    .single()
  if (error) throw error
  return result as AiProgramFeedback
}

// ─── Query ───────────────────────────────────────────────────────────────────

export async function getProgramFeedback(programId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("ai_program_feedback")
    .select("*")
    .eq("program_id", programId)
  if (error) throw error
  return data as AiProgramFeedback[]
}

export async function getRecentProgramFeedback(opts?: {
  splitType?: string
  difficulty?: string
  limit?: number
}) {
  const supabase = getClient()
  let query = supabase
    .from("ai_program_feedback")
    .select("*")

  if (opts?.splitType) {
    query = query.eq("split_type", opts.splitType)
  }
  if (opts?.difficulty) {
    query = query.eq("difficulty", opts.difficulty)
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 20)
  if (error) throw error
  return data as AiProgramFeedback[]
}

// ─── Vector search ───────────────────────────────────────────────────────────

export interface ProgramFeedbackSearchResult {
  id: string
  program_id: string
  overall_rating: number
  balance_quality: number | null
  exercise_selection_quality: number | null
  periodization_quality: number | null
  difficulty_appropriateness: number | null
  split_type: string | null
  difficulty: string | null
  specific_issues: AiProgramFeedback["specific_issues"]
  corrections_made: Record<string, unknown>
  notes: string | null
  similarity: number
}

export async function searchSimilarProgramFeedback(
  queryEmbedding: number[],
  opts?: {
    splitType?: string
    difficulty?: string
    threshold?: number
    limit?: number
  }
) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("match_ai_program_feedback", {
    query_embedding: JSON.stringify(queryEmbedding),
    target_split_type: opts?.splitType ?? null,
    target_difficulty: opts?.difficulty ?? null,
    match_threshold: opts?.threshold ?? 0.3,
    match_count: opts?.limit ?? 10,
  })
  if (error) throw error
  return (data ?? []) as ProgramFeedbackSearchResult[]
}

// ─── Update embedding ────────────────────────────────────────────────────────

export async function updateProgramFeedbackEmbedding(
  feedbackId: string,
  embedding: number[]
) {
  const supabase = getClient()
  const { error } = await supabase
    .from("ai_program_feedback")
    .update({ embedding: JSON.stringify(embedding) })
    .eq("id", feedbackId)
  if (error) throw error
}
