// lib/analytics/social.ts
// Computes SocialMetrics from raw social_posts + social_analytics snapshots.
// Called from app/(admin)/admin/analytics/page.tsx (server component).
//
// Pattern: mirrors computeShopMetrics in compute.ts — one function, filters by
// range, buckets by month, returns a flat shape for the tab to render.

import type { SocialPost, SocialAnalytics, SocialPlatform } from "@/types/database"
import type { DateRange, SocialMetrics } from "@/types/analytics"
import { getMonthsInRange, getMonthKey, inRange, capitalize } from "./compute"

const STATUSES = [
  "draft",
  "edited",
  "approved",
  "scheduled",
  "published",
  "rejected",
  "awaiting_connection",
  "failed",
] as const

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}

export function computeSocialMetrics(
  posts: SocialPost[],
  analytics: SocialAnalytics[],
  range: DateRange,
  previousRange: DateRange | null,
): SocialMetrics {
  const months = getMonthsInRange(range)

  const inRangePosts = posts.filter((p) => inRange(p.created_at, range))
  const inRangePublished = posts.filter((p) => p.published_at && inRange(p.published_at, range))

  const previousInRangePosts = previousRange ? posts.filter((p) => inRange(p.created_at, previousRange)) : []
  const previousInRangePublished = previousRange
    ? posts.filter((p) => p.published_at && inRange(p.published_at, previousRange))
    : []

  // Most-recent snapshot per post (within range). Avoids double-counting when
  // the same post appears in several nightly syncs across the period.
  const latestByPost = new Map<string, SocialAnalytics>()
  for (const row of analytics) {
    const existing = latestByPost.get(row.social_post_id)
    if (!existing || new Date(row.recorded_at) > new Date(existing.recorded_at)) {
      latestByPost.set(row.social_post_id, row)
    }
  }

  let totalImpressions = 0
  let totalEngagement = 0
  for (const snap of latestByPost.values()) {
    totalImpressions += snap.impressions ?? 0
    totalEngagement += snap.engagement ?? 0
  }

  // Posts by month — created count + published count.
  const postsByMonth = months.map((m) => ({ ...m, total: 0, published: 0 }))
  const monthMap = new Map(postsByMonth.map((m) => [m.key, m]))
  for (const p of inRangePosts) {
    const entry = monthMap.get(getMonthKey(new Date(p.created_at)))
    if (entry) entry.total += 1
  }
  for (const p of inRangePublished) {
    if (!p.published_at) continue
    const entry = monthMap.get(getMonthKey(new Date(p.published_at)))
    if (entry) entry.published += 1
  }

  // Posts by platform (published in range).
  const byPlatform = new Map<SocialPlatform, number>()
  for (const p of inRangePublished) {
    byPlatform.set(p.platform, (byPlatform.get(p.platform) ?? 0) + 1)
  }
  const postsByPlatform = Array.from(byPlatform.entries())
    .map(([platform, count]) => ({ label: capitalize(platform), count }))
    .sort((a, b) => b.count - a.count)

  // Posts by approval status (created in range).
  const byStatus = new Map<string, number>()
  for (const s of STATUSES) byStatus.set(s, 0)
  for (const p of inRangePosts) byStatus.set(p.approval_status, (byStatus.get(p.approval_status) ?? 0) + 1)
  const postsByStatus = Array.from(byStatus.entries())
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ label: capitalize(status), count }))
    .sort((a, b) => b.count - a.count)

  // Top posts by engagement (latest snapshot). Pair with their post content.
  const postById = new Map(posts.map((p) => [p.id, p]))
  const topPostsByEngagement = Array.from(latestByPost.values())
    .filter((snap) => (snap.engagement ?? 0) > 0)
    .sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0))
    .slice(0, 10)
    .map((snap) => {
      const post = postById.get(snap.social_post_id)
      return {
        social_post_id: snap.social_post_id,
        platform: snap.platform,
        content_preview: post ? truncate(post.content) : "(missing post)",
        engagement: snap.engagement ?? 0,
        impressions: snap.impressions ?? 0,
      }
    })

  return {
    totalPosts: inRangePosts.length,
    previousTotalPosts: previousInRangePosts.length,
    publishedPosts: inRangePublished.length,
    previousPublishedPosts: previousInRangePublished.length,
    totalImpressions,
    totalEngagement,
    postsByMonth,
    postsByPlatform,
    postsByStatus,
    topPostsByEngagement,
  }
}
