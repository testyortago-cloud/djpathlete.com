// lib/content-studio/insights-data.ts
// I/O half of the Insights tab. Fetch rows, hand them to the pure aggregator.
// Deliberately NOT a snapshot table + cron: social_analytics already IS the
// time series, and with this library's size there is nothing to cache.

import { listVideoUploads } from "@/lib/db/video-uploads"
import { listSocialPostsForPipeline, listSocialPostsBySourceVideo } from "@/lib/db/social-posts"
import { listSocialAnalyticsInRange, listSocialAnalyticsForPosts } from "@/lib/db/social-analytics"
import { listMediaAssets } from "@/lib/db/media-assets"
import { listAllSubmissions } from "@/lib/db/team-video-submissions"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import {
  computeStudioInsights,
  summarizeVideoPerformance,
  type StudioInsights,
  type VideoPerformanceSummary,
} from "./insights"

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

  const connectedPlatforms = new Set(connections.filter((c) => c.status === "connected").map((c) => c.plugin_name))

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

/**
 * Performance for a single video, scoped to just that video's own posts —
 * deliberately NOT computeStudioInsights(), which would pull every video,
 * post, asset and submission in the database to answer one panel's worth of
 * numbers for the video detail page. Fetches only this video's posts, their
 * analytics snapshots, and the platform connections, then runs them through
 * the same summarizeVideoPerformance ladder getInsightsData uses per video —
 * so the Insights tab and the video detail page can never disagree about the
 * same video's state.
 */
export async function getVideoPerformance(videoId: string): Promise<VideoPerformanceSummary | null> {
  const posts = await listSocialPostsBySourceVideo(videoId)
  const postIds = posts.map((p) => p.id)
  const [analytics, connections] = await Promise.all([listSocialAnalyticsForPosts(postIds), listPlatformConnections()])

  const connectedPlatforms = new Set(connections.filter((c) => c.status === "connected").map((c) => c.plugin_name))

  return summarizeVideoPerformance(videoId, posts, analytics, connectedPlatforms)
}
