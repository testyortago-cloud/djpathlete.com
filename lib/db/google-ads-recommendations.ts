// lib/db/google-ads-recommendations.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type {
  GoogleAdsRecommendation,
  GoogleAdsRecommendationScope,
  GoogleAdsRecommendationStatus,
  GoogleAdsRecommendationType,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface InsertRecommendationInput {
  customer_id: string
  scope_type: GoogleAdsRecommendationScope
  scope_id: string
  recommendation_type: GoogleAdsRecommendationType
  payload: Record<string, unknown>
  reasoning: string
  confidence: number
}

export async function insertRecommendations(
  rows: InsertRecommendationInput[],
): Promise<GoogleAdsRecommendation[]> {
  if (rows.length === 0) return []
  const supabase = getClient()
  const payload = rows.map((r) => ({
    customer_id: r.customer_id,
    scope_type: r.scope_type,
    scope_id: r.scope_id,
    recommendation_type: r.recommendation_type,
    payload: r.payload,
    reasoning: r.reasoning,
    confidence: r.confidence,
    status: "pending" as const,
    created_by_ai: true,
  }))
  const { data, error } = await supabase
    .from("google_ads_recommendations")
    .insert(payload)
    .select()
  if (error) throw error
  return (data ?? []) as GoogleAdsRecommendation[]
}

export interface ListRecommendationsOptions {
  customer_id?: string
  status?: GoogleAdsRecommendationStatus | GoogleAdsRecommendationStatus[]
  limit?: number
}

export async function listRecommendations(
  opts: ListRecommendationsOptions = {},
): Promise<GoogleAdsRecommendation[]> {
  const supabase = getClient()
  let query = supabase
    .from("google_ads_recommendations")
    .select("*")
    .order("confidence", { ascending: false })
    .order("created_at", { ascending: false })
  if (opts.customer_id) query = query.eq("customer_id", opts.customer_id)
  if (Array.isArray(opts.status)) {
    if (opts.status.length > 0) query = query.in("status", opts.status)
  } else if (opts.status) {
    query = query.eq("status", opts.status)
  }
  query = query.limit(opts.limit ?? 200)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as GoogleAdsRecommendation[]
}

export async function getRecommendationById(
  id: string,
): Promise<GoogleAdsRecommendation | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_recommendations")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as GoogleAdsRecommendation | null) ?? null
}

export async function approveRecommendation(
  id: string,
  approvedBy: string,
): Promise<GoogleAdsRecommendation> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_recommendations")
    .update({
      status: "approved",
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsRecommendation
}

export async function rejectRecommendation(
  id: string,
  rejectedBy: string,
): Promise<GoogleAdsRecommendation> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_recommendations")
    .update({
      status: "rejected",
      approved_by: rejectedBy,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsRecommendation
}

/**
 * Marks every still-pending recommendation older than now() as expired.
 * Used by the nightly cron to keep stale rows out of the approval queue —
 * the check constraint guarantees we never expire applied/auto_applied.
 */
export async function expireStaleRecommendations(): Promise<number> {
  const supabase = getClient()
  const { error, count } = await supabase
    .from("google_ads_recommendations")
    .update({ status: "expired" }, { count: "exact" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
  if (error) throw error
  return count ?? 0
}

export async function setRecommendationApplied(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("google_ads_recommendations")
    .update({ status: "applied", applied_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

export async function setRecommendationFailed(id: string, reason: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("google_ads_recommendations")
    .update({ status: "failed", failure_reason: reason })
    .eq("id", id)
  if (error) throw error
}

export interface RecommendationStatusCounts {
  pending: number
  approved: number
  applied: number
  rejected: number
  auto_applied: number
  failed: number
  expired: number
}

export async function getRecommendationStatusCounts(
  customerId?: string,
): Promise<RecommendationStatusCounts> {
  const supabase = getClient()
  let query = supabase.from("google_ads_recommendations").select("status")
  if (customerId) query = query.eq("customer_id", customerId)
  const { data, error } = await query
  if (error) throw error
  const counts: RecommendationStatusCounts = {
    pending: 0,
    approved: 0,
    applied: 0,
    rejected: 0,
    auto_applied: 0,
    failed: 0,
    expired: 0,
  }
  for (const row of (data ?? []) as Array<{ status: GoogleAdsRecommendationStatus }>) {
    counts[row.status]++
  }
  return counts
}
