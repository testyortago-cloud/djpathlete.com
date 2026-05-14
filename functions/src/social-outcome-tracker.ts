// Daily backfill: for each social_agent_memos row with outcome_status='pending'
// and created_at older than 14 days, summarize social_analytics for the linked
// post and flip the memo to 'measured'. Staggered to 04:45 UTC (after SEO 04:15
// and Ads 04:30).

import { getSupabase } from "./lib/supabase.js"

const AGE_DAYS = 14

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
    const metrics = {
      snapshots: list.length,
      likes: sum("likes"),
      comments: sum("comments"),
      shares: sum("shares"),
      impressions: sum("impressions"),
      latest_engagement_rate: list.at(-1)?.engagement_rate ?? null,
    }
    await supabase
      .from("social_agent_memos")
      .update({
        outcome_status: "measured",
        outcome_metrics: metrics,
        measured_at: new Date().toISOString(),
      })
      .eq("id", row.id)
    measured += 1
  }
  return { measured, skipped }
}
