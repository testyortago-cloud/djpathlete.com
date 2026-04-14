import { createServiceRoleClient } from "@/lib/supabase"
import type { AiConversationHistory, AiFeature } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

// ─── Insert ─────────────────────────────────────────────────────────────────

export async function saveConversationMessage(data: Omit<AiConversationHistory, "id" | "created_at">) {
  const supabase = getClient()
  const { embedding: _embedding, ...rest } = data
  const { data: result, error } = await supabase.from("ai_conversation_history").insert(rest).select().single()
  if (error) throw error
  return result as AiConversationHistory
}

export async function saveConversationBatch(messages: Omit<AiConversationHistory, "id" | "created_at">[]) {
  if (messages.length === 0) return []
  const supabase = getClient()
  const rows = messages.map(({ embedding: _embedding, ...rest }) => rest)
  const { data, error } = await supabase.from("ai_conversation_history").insert(rows).select()
  if (error) throw error
  return data as AiConversationHistory[]
}

// ─── Query ──────────────────────────────────────────────────────────────────

export async function getConversationBySession(sessionId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("ai_conversation_history")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return data as AiConversationHistory[]
}

export async function getConversationsByUser(userId: string, feature?: AiFeature, limit: number = 50) {
  const supabase = getClient()
  let query = supabase.from("ai_conversation_history").select("*").eq("user_id", userId)

  if (feature) {
    query = query.eq("feature", feature)
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit)
  if (error) throw error
  return data as AiConversationHistory[]
}

export async function getConversationMessageById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("ai_conversation_history").select("*").eq("id", id).single()
  if (error) throw error
  return data as AiConversationHistory
}

// ─── Embedding ──────────────────────────────────────────────────────────────

export async function updateMessageEmbedding(id: string, embedding: number[]): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("ai_conversation_history")
    .update({ embedding: JSON.stringify(embedding) } as Record<string, unknown>)
    .eq("id", id)
  if (error) throw error
}

// ─── Vector search ──────────────────────────────────────────────────────────

export interface ConversationSearchResult {
  id: string
  session_id: string
  feature: string
  role: string
  content: string
  metadata: Record<string, unknown>
  similarity: number
}

export async function searchSimilarConversations(
  queryEmbedding: number[],
  opts?: {
    feature?: AiFeature
    excludeSession?: string
    threshold?: number
    limit?: number
  },
): Promise<ConversationSearchResult[]> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("match_ai_conversations", {
    query_embedding: JSON.stringify(queryEmbedding),
    target_feature: opts?.feature ?? null,
    exclude_session: opts?.excludeSession ?? null,
    match_threshold: opts?.threshold ?? 0.4,
    match_count: opts?.limit ?? 10,
  })
  if (error) throw error
  return (data ?? []) as ConversationSearchResult[]
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export async function getConversationStats(feature?: AiFeature) {
  const supabase = getClient()
  let query = supabase.from("ai_conversation_history").select("id", { count: "exact", head: true })

  if (feature) {
    query = query.eq("feature", feature)
  }

  const { count, error } = await query
  if (error) throw error

  return { total_messages: count ?? 0 }
}
