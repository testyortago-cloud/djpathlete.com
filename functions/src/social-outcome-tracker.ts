// Daily backfill: for each social_agent_memos row with outcome_status='pending'
// and created_at older than 14 days, summarize social_analytics for the linked
// post, compute a weighted-engagement delta + normalized impact_score, and
// flip the memo to 'measured'. Staggered to 04:45 UTC (after SEO 04:15
// and Ads 04:30).

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

export async function runSocialOutcomeTracker(): Promise<SocialOutcomeResult> {
  const supabase = getSupabase()
  const cutoff = new Date(Date.now() - AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: aged } = await supabase
    .from("social_agent_memos")
    .select("id, social_post_id")
    .eq("outcome_status", "pending")
    .lt("created_at", cutoff)

  const rows = (aged as Array<{ id: string; social_post_id: string | null }> | null) ?? []
  let measured = 0
  let skipped = 0
  for (const row of rows) {
    if (!row.social_post_id) {
      skipped += 1
      continue
    }
    const { data: snapshots } = await supabase
      .from("social_analytics")
      .select("likes, comments, shares, impressions, engagement_rate")
      .eq("social_post_id", row.social_post_id)
    const list = (snapshots as Array<Record<string, number | null>> | null) ?? []
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

    const metrics = {
      snapshots: list.length,
      likes,
      comments,
      shares,
      impressions,
      latest_engagement_rate: list.at(-1)?.engagement_rate ?? null,
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
