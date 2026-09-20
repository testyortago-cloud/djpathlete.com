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

/**
 * All snapshots for a specific set of posts (every recorded_at, not just the
 * latest — callers that need "latest per post" reduce this themselves, same
 * as summarizeVideoPerformance does). Used by the video detail page's
 * performance panel, which must not pull the whole `social_analytics` table
 * (listSocialAnalyticsInRange) to answer one video's worth of numbers.
 */
export async function listSocialAnalyticsForPosts(postIds: string[]): Promise<SocialAnalytics[]> {
  if (postIds.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_analytics")
    .select("*")
    .in("social_post_id", postIds)
    .order("recorded_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as SocialAnalytics[]
}
