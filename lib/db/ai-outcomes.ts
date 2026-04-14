import { createServiceRoleClient } from "@/lib/supabase"
import type { AiOutcomeTracking, AiRecommendationType } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

// ─── Create ─────────────────────────────────────────────────────────────────

export async function createOutcomeTracking(data: Omit<AiOutcomeTracking, "id" | "created_at">) {
  const supabase = getClient()
  const { data: result, error } = await supabase.from("ai_outcome_tracking").insert(data).select().single()
  if (error) throw error
  return result as AiOutcomeTracking
}

// ─── Resolve (fill in actual outcome) ───────────────────────────────────────

export async function resolveOutcome(
  id: string,
  actualValue: Record<string, unknown>,
  accuracyScore: number | null,
  outcomePositive: boolean | null,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("ai_outcome_tracking")
    .update({
      actual_value: actualValue,
      accuracy_score: accuracyScore,
      outcome_positive: outcomePositive,
      measured_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as AiOutcomeTracking
}

// ─── Query pending outcomes ─────────────────────────────────────────────────

export async function getPendingOutcomes(userId: string, exerciseId?: string): Promise<AiOutcomeTracking[]> {
  const supabase = getClient()
  let query = supabase.from("ai_outcome_tracking").select("*").eq("user_id", userId).is("actual_value", null)

  if (exerciseId) {
    query = query.eq("exercise_id", exerciseId)
  }

  const { data, error } = await query.order("created_at", { ascending: false })
  if (error) throw error
  return data as AiOutcomeTracking[]
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export interface OutcomeAccuracyStats {
  total_predictions: number
  resolved_count: number
  avg_accuracy: number | null
  positive_count: number
  negative_count: number
}

export async function getAccuracyStats(recommendationType?: AiRecommendationType): Promise<OutcomeAccuracyStats> {
  const supabase = getClient()
  let query = supabase.from("ai_outcome_tracking").select("*")

  if (recommendationType) {
    query = query.eq("recommendation_type", recommendationType)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = data as AiOutcomeTracking[]
  const resolved = rows.filter((r) => r.actual_value != null)
  const withAccuracy = resolved.filter((r) => r.accuracy_score != null)
  const avg =
    withAccuracy.length > 0
      ? withAccuracy.reduce((sum, r) => sum + (r.accuracy_score ?? 0), 0) / withAccuracy.length
      : null

  return {
    total_predictions: rows.length,
    resolved_count: resolved.length,
    avg_accuracy: avg,
    positive_count: resolved.filter((r) => r.outcome_positive === true).length,
    negative_count: resolved.filter((r) => r.outcome_positive === false).length,
  }
}

export async function getWeightPredictionAccuracy(): Promise<{
  total: number
  resolved: number
  avg_accuracy: number | null
  within_5pct: number
  within_10pct: number
}> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("ai_outcome_tracking")
    .select("*")
    .eq("recommendation_type", "weight_suggestion")

  if (error) throw error

  const rows = data as AiOutcomeTracking[]
  const resolved = rows.filter((r) => r.actual_value != null && r.accuracy_score != null)

  const avg =
    resolved.length > 0 ? resolved.reduce((sum, r) => sum + (r.accuracy_score ?? 0), 0) / resolved.length : null

  return {
    total: rows.length,
    resolved: resolved.length,
    avg_accuracy: avg,
    within_5pct: resolved.filter((r) => (r.accuracy_score ?? 0) >= 0.95).length,
    within_10pct: resolved.filter((r) => (r.accuracy_score ?? 0) >= 0.9).length,
  }
}

// ─── Resolve weight outcomes for an exercise after progress is logged ────

export async function resolveWeightOutcomes(userId: string, exerciseId: string, actualWeightKg: number): Promise<void> {
  const pending = await getPendingOutcomes(userId, exerciseId)
  const weightPredictions = pending.filter((p) => p.recommendation_type === "weight_suggestion")

  for (const prediction of weightPredictions) {
    const predictedWeight = (prediction.predicted_value as { weight_kg?: number })?.weight_kg
    if (predictedWeight == null) continue

    const accuracy = Math.max(0, 1 - Math.abs(predictedWeight - actualWeightKg) / predictedWeight)
    const isPositive = accuracy >= 0.9 // within 10% is a positive outcome

    await resolveOutcome(prediction.id, { weight_kg: actualWeightKg }, accuracy, isPositive)
  }
}
