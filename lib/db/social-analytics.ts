// lib/db/social-analytics.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { SocialAnalytics } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function insertSocialAnalytics(row: Omit<SocialAnalytics, "id" | "created_at">): Promise<SocialAnalytics> {
  const supabase = getClient()
  const { data, error } = await supabase.from("social_analytics").insert(row).select().single()
  if (error) throw error
  return data as SocialAnalytics
}

export async function listRecentAnalyticsByPost(socialPostId: string, limit = 30): Promise<SocialAnalytics[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_analytics")
    .select("*")
    .eq("social_post_id", socialPostId)
    .order("recorded_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as SocialAnalytics[]
}

export async function listSocialAnalyticsInRange(from: Date, to: Date): Promise<SocialAnalytics[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_analytics")
    .select("*")
    .gte("recorded_at", from.toISOString())
    .lte("recorded_at", to.toISOString())
    .order("recorded_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as SocialAnalytics[]
}
