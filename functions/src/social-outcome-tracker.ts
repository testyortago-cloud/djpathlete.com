// Daily backfill: for each social_agent_memos row with outcome_status='pending'
// and created_at older than 14 days, summarize social_analytics for all linked
// posts, compute a weighted-engagement delta + normalized impact_score, and
// flip the memo to 'measured'. Staggered to 04:45 UTC (after SEO 04:15
// and Ads 04:30).
//
// Multi-platform memos: a single memo can link to N posts (one per platform).
// We sum engagement across all linked posts so impact_score reflects the run's
// total reach. Legacy memos that set memo.social_post_id are still supported.

import { getSupabase } from "./lib/supabase.js"
import {
  socialEngagementDelta,
  computeImpactScore,
  getSocialBaseline,
  refreshSocialBaseline,
} from "./social/outcome-scoring.js"

const AGE_DAYS = 14
const SOCIAL_TOOL_NAME = "drafted_social_post"

export interface SocialOutcomeResult {
  measured: number
  skipped: number
}

interface MemoAction {
  kind?: string
  payload?: { social_post_id?: string }
}

/**
 * Extract every social_post_id linked to a memo.
 *
 * Legacy memos populated memo.social_post_id directly (one post per memo).
 * Multi-platform memos leave that column null and store one entry per platform
 * inside memo.actions[i].payload.social_post_id.
 *
 * Prefer the legacy column when set; otherwise fall back to actions[].
 */
export function collectMemoPostIds(memo: {
  social_post_id: string | null
  actions: MemoAction[] | null
}): string[] {
  if (memo.social_post_id) return [memo.social_post_id]
  const acts = memo.actions ?? []
  return acts
    .filter((a) => a?.kind === SOCIAL_TOOL_NAME)
    .map((a) => a.payload?.social_post_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
}

export async function runSocialOutcomeTracker(): Promise<SocialOutcomeResult> {
  const supabase = getSupabase()
  const cutoff = new Date(Date.now() - AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: aged } = await supabase
    .from("social_agent_memos")
    .select("id, social_post_id, actions")
    .eq("outcome_status", "pending")
    .lt("created_at", cutoff)

  const rows =
    (aged as Array<{
      id: string
      social_post_id: string | null
      actions: MemoAction[] | null
    }> | null) ?? []
  let measured = 0
  let skipped = 0
  for (const row of rows) {
    const postIds = collectMemoPostIds(row)
    if (postIds.length === 0) {
      skipped += 1
      continue
    }

    // Sum analytics across every linked post — this is the multi-platform
    // total. For a legacy single-platform memo postIds.length is 1.
    const { data: snapshots } = await supabase
      .from("social_analytics")
      .select("social_post_id, likes, comments, shares, impressions, engagement_rate, captured_at")
      .in("social_post_id", postIds)
    const list = (snapshots as Array<Record<string, number | string | null>> | null) ?? []
    const sum = (k: string) => list.reduce((acc, s) => acc + (Number(s[k]) || 0), 0)
    const likes = sum("likes")
    const comments = sum("comments")
    const shares = sum("shares")
    const impressions = sum("impressions")

    const engagement_delta = socialEngagementDelta({
      likes,
      comments,
      shares,
      impressions,
    })

    // Score against the social/drafted_social_post baseline. Social actions
    // always predict more engagement, so direction = "increase".
    const baseline = await getSocialBaseline(supabase, SOCIAL_TOOL_NAME)
    const impact_score = computeImpactScore({
      delta: engagement_delta,
      predicted_direction: "increase",
      baseline_p95: baseline?.p95_abs_delta ?? 0,
      baseline_n_measured: baseline?.n_measured ?? 0,
    })

    // Pick the most recent engagement_rate across all posts as a coarse
    // "latest" indicator. Multi-platform memos don't have a single canonical
    // rate so this is just informational.
    const latestEngagementRate = list
      .filter((s) => s.engagement_rate != null)
      .map((s) => Number(s.engagement_rate))
      .pop() ?? null

    const metrics = {
      snapshots: list.length,
      post_count: postIds.length,
      likes,
      comments,
      shares,
      impressions,
      latest_engagement_rate: latestEngagementRate,
      engagement_delta,
    }

    await supabase
      .from("social_agent_memos")
      .update({
        outcome_status: "measured",
        outcome_metrics: metrics,
        impact_score,
        measured_at: new Date().toISOString(),
      })
      .eq("id", row.id)
    measured += 1
  }

  // Refresh the social baseline once per batch so the next agent run (and the
  // next tracker pass) sees fresh per-tool aggregates.
  if (measured > 0) {
    try {
      await refreshSocialBaseline(supabase)
    } catch (err) {
      console.error("[social-outcome-tracker] refreshSocialBaseline failed:", err)
    }
  }

  return { measured, skipped }
}
