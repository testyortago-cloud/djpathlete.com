// lib/db/google-ads-automation-log.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type {
  GoogleAdsAutomationLog,
  GoogleAdsAutomationLogResult,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface InsertAutomationLogInput {
  recommendation_id: string | null
  customer_id: string
  mode: string
  actor: string // 'system' or user_id
  api_request: Record<string, unknown>
  api_response?: Record<string, unknown> | null
  result_status: GoogleAdsAutomationLogResult
  error_message?: string | null
}

export async function insertAutomationLog(
  input: InsertAutomationLogInput,
): Promise<GoogleAdsAutomationLog> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_automation_log")
    .insert({
      recommendation_id: input.recommendation_id,
      customer_id: input.customer_id,
      mode: input.mode,
      actor: input.actor,
      api_request: input.api_request,
      api_response: input.api_response ?? null,
      result_status: input.result_status,
      error_message: input.error_message ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsAutomationLog
}

export async function listAutomationLogForRecommendation(
  recommendationId: string,
): Promise<GoogleAdsAutomationLog[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_automation_log")
    .select("*")
    .eq("recommendation_id", recommendationId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as GoogleAdsAutomationLog[]
}

export async function listRecentAutomationLog(
  limit: number = 50,
): Promise<GoogleAdsAutomationLog[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_automation_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as GoogleAdsAutomationLog[]
}
