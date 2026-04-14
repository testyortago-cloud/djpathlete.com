import { createServiceRoleClient } from "@/lib/supabase"
import type { AiResponseFeedback, AiFeature } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

// ─── Upsert (create or update) ──────────────────────────────────────────────

export async function submitFeedback(data: Omit<AiResponseFeedback, "id" | "created_at" | "updated_at">) {
  const supabase = getClient()
  const { data: result, error } = await supabase
    .from("ai_response_feedback")
    .upsert(data, { onConflict: "conversation_message_id,user_id" })
    .select()
    .single()
  if (error) throw error
  return result as AiResponseFeedback
}

// ─── Query ──────────────────────────────────────────────────────────────────

export async function getFeedbackForMessage(messageId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("ai_response_feedback")
    .select("*")
    .eq("conversation_message_id", messageId)
  if (error) throw error
  return data as AiResponseFeedback[]
}

export async function getFeedbackByFeature(feature?: AiFeature, limit: number = 50) {
  const supabase = getClient()
  let query = supabase.from("ai_response_feedback").select("*")

  if (feature) {
    query = query.eq("feature", feature)
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit)
  if (error) throw error
  return data as AiResponseFeedback[]
}

// ─── Aggregation ────────────────────────────────────────────────────────────

export interface FeedbackAggregation {
  total_count: number
  avg_accuracy: number | null
  avg_relevance: number | null
  avg_helpfulness: number | null
  thumbs_up_count: number
  thumbs_down_count: number
}

export async function getAggregatedFeedback(feature?: AiFeature): Promise<FeedbackAggregation> {
  const supabase = getClient()
  let query = supabase.from("ai_response_feedback").select("*")

  if (feature) {
    query = query.eq("feature", feature)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = data as AiResponseFeedback[]
  if (rows.length === 0) {
    return {
      total_count: 0,
      avg_accuracy: null,
      avg_relevance: null,
      avg_helpfulness: null,
      thumbs_up_count: 0,
      thumbs_down_count: 0,
    }
  }

  const accuracyRatings = rows.filter((r) => r.accuracy_rating != null).map((r) => r.accuracy_rating!)
  const relevanceRatings = rows.filter((r) => r.relevance_rating != null).map((r) => r.relevance_rating!)
  const helpfulnessRatings = rows.filter((r) => r.helpfulness_rating != null).map((r) => r.helpfulness_rating!)

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null)

  return {
    total_count: rows.length,
    avg_accuracy: avg(accuracyRatings),
    avg_relevance: avg(relevanceRatings),
    avg_helpfulness: avg(helpfulnessRatings),
    thumbs_up_count: rows.filter((r) => r.thumbs_up === true).length,
    thumbs_down_count: rows.filter((r) => r.thumbs_up === false).length,
  }
}

export interface FeedbackTrendPoint {
  week: string
  avg_accuracy: number | null
  avg_relevance: number | null
  avg_helpfulness: number | null
  count: number
}

export async function getFeedbackTrends(feature?: AiFeature, weeksBack: number = 12): Promise<FeedbackTrendPoint[]> {
  const supabase = getClient()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - weeksBack * 7)

  let query = supabase.from("ai_response_feedback").select("*").gte("created_at", cutoff.toISOString())

  if (feature) {
    query = query.eq("feature", feature)
  }

  const { data, error } = await query.order("created_at", { ascending: true })
  if (error) throw error

  const rows = data as AiResponseFeedback[]

  // Group by ISO week
  const weekMap = new Map<string, AiResponseFeedback[]>()
  for (const row of rows) {
    const date = new Date(row.created_at)
    const yearWeek = getISOWeek(date)
    const existing = weekMap.get(yearWeek) ?? []
    existing.push(row)
    weekMap.set(yearWeek, existing)
  }

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null)

  return Array.from(weekMap.entries()).map(([week, items]) => ({
    week,
    avg_accuracy: avg(items.filter((r) => r.accuracy_rating != null).map((r) => r.accuracy_rating!)),
    avg_relevance: avg(items.filter((r) => r.relevance_rating != null).map((r) => r.relevance_rating!)),
    avg_helpfulness: avg(items.filter((r) => r.helpfulness_rating != null).map((r) => r.helpfulness_rating!)),
    count: items.length,
  }))
}

function getISOWeek(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`
}
