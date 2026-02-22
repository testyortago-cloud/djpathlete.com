import { createServiceRoleClient } from "@/lib/supabase"
import type { Exercise } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function updateExerciseEmbedding(
  exerciseId: string,
  embedding: number[]
): Promise<void> {
  const supabase = getClient()
  // pgvector accepts embedding as a string: '[0.1, 0.2, ...]'
  const { error } = await supabase
    .from("exercises")
    .update({ embedding: JSON.stringify(embedding) } as Record<string, unknown>)
    .eq("id", exerciseId)
  if (error) throw error
}

export async function searchExercisesByEmbedding(
  queryEmbedding: number[],
  limit: number = 20,
  threshold: number = 0.3
): Promise<Array<{ id: string; similarity: number }>> {
  const supabase = getClient()
  // pgvector expects the embedding as a string for RPC
  const { data, error } = await supabase.rpc("match_exercises", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: threshold,
    match_count: limit,
  })
  if (error) throw error
  return (data ?? []) as Array<{ id: string; similarity: number }>
}

export async function getExercisesWithEmbeddingCount(): Promise<{
  total: number
  embedded: number
}> {
  const supabase = getClient()
  const { data: all, error: allErr } = await supabase
    .from("exercises")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
  if (allErr) throw allErr

  const { data: withEmb, error: embErr } = await supabase
    .from("exercises")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .not("embedding", "is", null)
  if (embErr) throw embErr

  return {
    total: (all as unknown as { count: number })?.count ?? 0,
    embedded: (withEmb as unknown as { count: number })?.count ?? 0,
  }
}

export async function getAllExercisesForEmbedding(): Promise<Exercise[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .eq("is_active", true)
    .order("name")
  if (error) throw error
  return data as Exercise[]
}
