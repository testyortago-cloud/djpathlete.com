// functions/src/sync-platform-analytics.ts
// Nightly scheduled Firebase Function: walks every published social_post and
// asks the Next.js side (via the /api/admin/internal/sync-post-analytics
// route) to call the matching plugin's fetchAnalytics(). Each non-empty
// result becomes a new row in social_analytics (time-series snapshot).
//
// The onSchedule wrapper is defined in functions/src/index.ts so this file
// can be imported and unit-tested as a pure function.

import { getSupabase } from "./lib/supabase.js"
import { isCronSkipped } from "./lib/system-settings.js"

const POSTS_PER_RUN_LIMIT = 500

export interface SyncPlatformAnalyticsResult {
  synced: number
  skipped: number
  failed: number
  paused?: true
}

export interface RunSyncOptions {
  fetchImpl?: typeof fetch
  supabaseImpl?: ReturnType<typeof getSupabase>
  internalToken?: string
  appUrl?: string
  limit?: number
}

interface PublishedPostRow {
  id: string
  platform: string
  platform_post_id: string
}

interface SyncResponseBody {
  socialPostId: string
  platform: string
  platformPostId: string
  metrics: Record<string, number | undefined> | null
  reason?: string
}

/**
 * Runs one nightly analytics sync. Safe to invoke manually for backfills or
 * dry-runs. Never throws — every per-post failure increments `failed` but
 * lets the rest of the batch continue. Returns counters for log visibility.
 */
export async function runSyncPlatformAnalytics(options: RunSyncOptions = {}): Promise<SyncPlatformAnalyticsResult> {
  const supabase = options.supabaseImpl ?? getSupabase()
  const fetchImpl = options.fetchImpl ?? fetch
  const internalToken = options.internalToken ?? process.env.INTERNAL_CRON_TOKEN ?? ""
  const appUrl = options.appUrl ?? process.env.APP_URL ?? ""
  const limit = options.limit ?? POSTS_PER_RUN_LIMIT

  if (!internalToken) {
    throw new Error("INTERNAL_CRON_TOKEN is not configured")
  }
  if (!appUrl) {
    throw new Error("APP_URL is not configured")
  }

  const gate = await isCronSkipped(
    { enabledKey: "cron_analytics_sync_enabled", defaultEnabled: true },
    supabase,
  )
  if (gate.skipped) {
    console.log(`[sync-platform-analytics] skipped — ${gate.reason}`)
    return { synced: 0, skipped: 0, failed: 0, paused: true }
  }

  // Pull published posts that have a platform_post_id to query against.
  const { data: rows, error: selErr } = await supabase
    .from("social_posts")
    .select("id, platform, platform_post_id")
    .eq("approval_status", "published")
    .not("platform_post_id", "is", null)
    .order("published_at", { ascending: false })
    .limit(limit)

  if (selErr) {
    throw new Error(`Failed to list published social_posts: ${selErr.message}`)
  }

  const posts = (rows ?? []) as PublishedPostRow[]
  const counters: SyncPlatformAnalyticsResult = { synced: 0, skipped: 0, failed: 0 }
  const endpoint = `${appUrl.replace(/\/$/, "")}/api/admin/internal/sync-post-analytics`

  for (const post of posts) {
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${internalToken}`,
        },
        body: JSON.stringify({ socialPostId: post.id }),
      })

      if (!res.ok) {
        counters.failed += 1
        continue
      }

      const body = (await res.json()) as SyncResponseBody
      if (!body.metrics) {
        counters.skipped += 1
        continue
      }

      const metrics = body.metrics
      const coreKeys = new Set(["impressions", "engagement", "likes", "comments", "shares", "views"])
      const extraEntries = Object.entries(metrics).filter(([k]) => !coreKeys.has(k))

      const { error: insErr } = await supabase.from("social_analytics").insert({
        social_post_id: post.id,
        platform: post.platform,
        platform_post_id: post.platform_post_id,
        impressions: metrics.impressions ?? null,
        engagement: metrics.engagement ?? null,
        likes: metrics.likes ?? null,
        comments: metrics.comments ?? null,
        shares: metrics.shares ?? null,
        views: metrics.views ?? null,
        extra: extraEntries.length > 0 ? Object.fromEntries(extraEntries) : null,
        recorded_at: new Date().toISOString(),
      })

      if (insErr) {
        counters.failed += 1
      } else {
        counters.synced += 1
      }
    } catch {
      counters.failed += 1
    }
  }

  return counters
}
