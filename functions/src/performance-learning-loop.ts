// functions/src/performance-learning-loop.ts
// Weekly scheduled Firebase Function (Mon 03:00 America/Chicago). Picks the
// top 3 performing published social_posts per platform from the last 30 days
// (ranked by engagement on the latest snapshot) and writes them as
// `few_shot_examples` on the matching prompt_templates row.
//
// No Claude calls. No mutation of engagement data. Pure aggregation.
// The onSchedule wrapper lives in functions/src/index.ts so this file is
// unit-testable as a pure function via `runPerformanceLearningLoop()`.

import type { SupabaseClient } from "@supabase/supabase-js"
import { getSupabase } from "./lib/supabase.js"
import { isCronSkipped } from "./lib/system-settings.js"

const PLATFORMS = ["facebook", "instagram", "tiktok", "youtube", "youtube_shorts", "linkedin"] as const
export type LearningLoopPlatform = (typeof PLATFORMS)[number]

const CAPTION_MAX_CHARS = 500
const DEFAULT_LOOKBACK_DAYS = 30
const DEFAULT_TOP_N = 3

interface SocialPostRow {
  id: string
  content: string
  platform: LearningLoopPlatform
  published_at: string | null
}

interface AnalyticsRow {
  social_post_id: string
  impressions: number | null
  engagement: number | null
  recorded_at: string
}

export interface FewShotExample {
  caption: string
  platform: LearningLoopPlatform
  engagement: number
  impressions: number
  recorded_at: string
  social_post_id: string
}

export interface RunPerformanceLearningLoopOptions {
  supabaseImpl?: SupabaseClient
  now?: Date
  topN?: number
  lookbackDays?: number
}

export interface PerformanceLearningLoopResult {
  platformsUpdated: LearningLoopPlatform[]
  platformsSkippedEmpty: LearningLoopPlatform[]
  totalExamplesWritten: number
  errors: number
  paused?: true
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}

export async function runPerformanceLearningLoop(
  options: RunPerformanceLearningLoopOptions = {},
): Promise<PerformanceLearningLoopResult> {
  const supabase = options.supabaseImpl ?? getSupabase()
  const now = options.now ?? new Date()
  const topN = options.topN ?? DEFAULT_TOP_N
  const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const sinceIso = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString()

  const result: PerformanceLearningLoopResult = {
    platformsUpdated: [],
    platformsSkippedEmpty: [],
    totalExamplesWritten: 0,
    errors: 0,
  }

  const gate = await isCronSkipped(
    { enabledKey: "cron_performance_loop_enabled", defaultEnabled: true },
    supabase,
  )
  if (gate.skipped) {
    console.log(`[performance-learning-loop] skipped — ${gate.reason}`)
    return { ...result, paused: true }
  }

  for (const platform of PLATFORMS) {
    try {
      const examples = await collectTopExamplesForPlatform(supabase, platform, sinceIso, topN)

      if (examples.length === 0) {
        result.platformsSkippedEmpty.push(platform)
        continue
      }

      const { error: updErr } = await supabase
        .from("prompt_templates")
        .update({ few_shot_examples: examples })
        .eq("category", "social_caption")
        .eq("scope", platform)

      if (updErr) {
        console.error(`[performance-learning-loop] update failed for ${platform}:`, updErr)
        result.errors += 1
        continue
      }

      result.platformsUpdated.push(platform)
      result.totalExamplesWritten += examples.length
    } catch (err) {
      console.error(`[performance-learning-loop] unexpected error for ${platform}:`, err)
      result.errors += 1
    }
  }

  return result
}

async function collectTopExamplesForPlatform(
  supabase: SupabaseClient,
  platform: LearningLoopPlatform,
  sinceIso: string,
  topN: number,
): Promise<FewShotExample[]> {
  const { data: postsData, error: postsErr } = await supabase
    .from("social_posts")
    .select("id, content, platform, published_at")
    .eq("platform", platform)
    .eq("approval_status", "published")
    .gte("published_at", sinceIso)
    .order("published_at", { ascending: false })
    .limit(100)

  if (postsErr) throw new Error(`social_posts fetch for ${platform}: ${postsErr.message}`)
  const posts = (postsData ?? []) as SocialPostRow[]
  if (posts.length === 0) return []

  const postIds = posts.map((p) => p.id)
  const { data: analyticsData, error: analyticsErr } = await supabase
    .from("social_analytics")
    .select("social_post_id, impressions, engagement, recorded_at")
    .in("social_post_id", postIds)
    .gte("recorded_at", sinceIso)
    .order("recorded_at", { ascending: false })

  if (analyticsErr) throw new Error(`social_analytics fetch for ${platform}: ${analyticsErr.message}`)

  const latestByPost = new Map<string, AnalyticsRow>()
  for (const row of (analyticsData ?? []) as AnalyticsRow[]) {
    const existing = latestByPost.get(row.social_post_id)
    if (!existing || new Date(row.recorded_at) > new Date(existing.recorded_at)) {
      latestByPost.set(row.social_post_id, row)
    }
  }

  const postById = new Map(posts.map((p) => [p.id, p]))
  const ranked = Array.from(latestByPost.values())
    .filter((row) => (row.engagement ?? 0) > 0)
    .sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0))
    .slice(0, topN)

  return ranked.map((snap) => {
    const post = postById.get(snap.social_post_id)
    return {
      caption: post ? truncate(post.content, CAPTION_MAX_CHARS) : "",
      platform,
      engagement: snap.engagement ?? 0,
      impressions: snap.impressions ?? 0,
      recorded_at: snap.recorded_at,
      social_post_id: snap.social_post_id,
    }
  })
}
