// lib/content-studio/insights-data.ts
// I/O half of the Insights tab. Fetch rows, hand them to the pure aggregator.
// Deliberately NOT a snapshot table + cron: social_analytics already IS the
// time series, and with this library's size there is nothing to cache.

import { listVideoUploads } from "@/lib/db/video-uploads"
import { listSocialPostsForPipeline } from "@/lib/db/social-posts"
import { listSocialAnalyticsInRange } from "@/lib/db/social-analytics"
import { listMediaAssets } from "@/lib/db/media-assets"
import { listAllSubmissions } from "@/lib/db/team-video-submissions"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { computeStudioInsights, type StudioInsights } from "./insights"

const PERIOD_DAYS = 30

export async function getInsightsData(): Promise<StudioInsights> {
  const now = new Date()
  const from = new Date(now.getTime() - PERIOD_DAYS * 2 * 86_400_000)

  const [videos, posts, analytics, assets, submissions, connections] = await Promise.all([
    listVideoUploads({ limit: 500 }),
    listSocialPostsForPipeline(),
    listSocialAnalyticsInRange(from, now),
    listMediaAssets({}),
    listAllSubmissions(),
    listPlatformConnections(),
  ])

  const connectedPlatforms = new Set(
    connections.filter((c) => c.status === "connected").map((c) => c.plugin_name),
  )

  return computeStudioInsights({
    now,
    videos,
    posts,
    analytics,
    assets,
    submissions,
    connectedPlatforms,
    periodDays: PERIOD_DAYS,
  })
}
