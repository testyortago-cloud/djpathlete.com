// lib/seo-agent/outcomes.ts
// Per-tool outcome resolvers used by the daily outcome-tracker cron. Each
// resolver takes the action's execution_target_id (plus run date / clients)
// and returns the per-action OutcomeMetric slice for the memo.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Firestore } from "firebase-admin/firestore"
import type { SeoAgentMemoOutcomeMetric } from "@/types/database"

// The resolvers return everything except `action_index`, which the
// orchestrator (in the route) adds after collecting results.
export type ResolvedOutcome = Omit<SeoAgentMemoOutcomeMetric, "action_index">

const SITE_URL = "https://www.darrenjpaul.com"

// ─── Shared GSC delta helper ───────────────────────────────────────────────

interface GscWindowResult {
  clicks: number
  impressions: number
  position: number | null
}

/**
 * Sum clicks/impressions and compute impression-weighted avg position for a
 * single page over a date window. Returns position=null when the window has
 * zero impressions (avoids divide-by-zero AND signals "no data").
 */
async function gscDeltaForPage(
  supabase: SupabaseClient,
  page: string,
  startDate: string,
  endDate: string,
): Promise<GscWindowResult> {
  const { data, error } = await supabase
    .from("gsc_query_daily")
    .select("clicks, impressions, position")
    .eq("page", page)
    .gte("date", startDate)
    .lte("date", endDate)
  if (error) throw error
  type Row = { clicks: number; impressions: number; position: number }
  const rows = (data as Row[] | null) ?? []
  let clicks = 0
  let impressions = 0
  let weightedPosition = 0
  for (const r of rows) {
    clicks += r.clicks
    impressions += r.impressions
    weightedPosition += r.position * r.impressions
  }
  return {
    clicks,
    impressions,
    position: impressions > 0 ? weightedPosition / impressions : null,
  }
}

function isoDateOffset(baseIso: string, daysOffset: number): string {
  const d = new Date(baseIso)
  d.setUTCDate(d.getUTCDate() + daysOffset)
  return d.toISOString().slice(0, 10)
}

function pageUrlForSlug(slug: string): string {
  return `${SITE_URL}/blog/${slug}`
}

// ─── resolveNewPostOutcome ─────────────────────────────────────────────────

/**
 * For queue_new_post: the execution_target_id is a content_calendar row id.
 * If the auto-blog cron has picked it up (`reference_id` is set), measure
 * GSC clicks/position in the (post.published_at + 7) → (+21) window.
 * Otherwise return a note that the topic was never picked up.
 */
export async function resolveNewPostOutcome(
  executionTargetId: string,
  supabase: SupabaseClient,
): Promise<ResolvedOutcome> {
  const { data: ccRow, error: ccErr } = await supabase
    .from("content_calendar")
    .select("id, reference_id, status")
    .eq("id", executionTargetId)
    .maybeSingle()
  if (ccErr) throw ccErr
  if (!ccRow) {
    return { executed: true, target_id: null, error: "content_calendar row not found" }
  }
  const refId = (ccRow as { reference_id: string | null }).reference_id
  if (!refId) {
    return { executed: true, target_id: null, note: "topic_suggestion_not_yet_picked_up" }
  }

  const { data: post, error: postErr } = await supabase
    .from("blog_posts")
    .select("id, slug, published_at")
    .eq("id", refId)
    .maybeSingle()
  if (postErr) throw postErr
  if (!post) {
    return { executed: true, target_id: refId, error: "blog_post not found" }
  }
  const p = post as { id: string; slug: string; published_at: string | null }
  if (!p.published_at) {
    return { executed: true, target_id: p.id, note: "post_not_yet_published" }
  }

  // Window: [+1, +12] after publish.
  // Rationale: outcome tracker fires at memo + 14d; auto-blog typically publishes
  // on memo + 2d (next Tuesday). So at first measurement, publish_date + 12d is
  // the most recent full day with GSC data. Earlier specs called for [+7, +21]
  // but that window extends beyond the 14-day measurement cutoff and produces
  // a systematic under-count on the only measurement we ever take per memo.
  const startDate = isoDateOffset(p.published_at, 1)
  const endDate = isoDateOffset(p.published_at, 12)
  const window = await gscDeltaForPage(supabase, pageUrlForSlug(p.slug), startDate, endDate)
  return {
    executed: true,
    target_id: p.id,
    clicks_before: 0,
    clicks_after: window.clicks,
    position_before: null,
    position_after: window.position,
  }
}

// ─── resolveRefreshOutcome ─────────────────────────────────────────────────

/**
 * For queue_refresh: the execution_target_id is a Firestore ai_jobs doc id.
 * Read the doc to get input.blogPostId, then read blog_posts.last_refreshed_at,
 * then measure GSC in 14-day windows BEFORE and AFTER that timestamp.
 */
export async function resolveRefreshOutcome(
  executionTargetId: string,
  supabase: SupabaseClient,
  firestore: Firestore,
): Promise<ResolvedOutcome> {
  const jobSnap = await firestore.collection("ai_jobs").doc(executionTargetId).get()
  if (!jobSnap.exists) {
    return { executed: true, target_id: null, error: "ai_job not found" }
  }
  // CONTRACT: `input.blogPostId` is written by functions/src/seo/execute.ts:executeQueueRefresh.
  // The field name MUST match exactly. If you rename it on either side without updating
  // the other, every refresh outcome will silently report this error metric.
  const job = jobSnap.data() as { input?: { blogPostId?: string } } | undefined
  const blogPostId = job?.input?.blogPostId
  if (!blogPostId) {
    return { executed: true, target_id: null, error: "ai_job missing input.blogPostId" }
  }

  const { data: post, error: postErr } = await supabase
    .from("blog_posts")
    .select("id, slug, last_refreshed_at")
    .eq("id", blogPostId)
    .maybeSingle()
  if (postErr) throw postErr
  if (!post) {
    return { executed: true, target_id: blogPostId, error: "blog_post not found" }
  }
  const p = post as { id: string; slug: string; last_refreshed_at: string | null }
  if (!p.last_refreshed_at) {
    return { executed: true, target_id: p.id, error: "blog_post has no last_refreshed_at" }
  }

  const beforeStart = isoDateOffset(p.last_refreshed_at, -14)
  const beforeEnd = isoDateOffset(p.last_refreshed_at, -1)
  const afterStart = isoDateOffset(p.last_refreshed_at, 1)
  const afterEnd = isoDateOffset(p.last_refreshed_at, 14)
  const pageUrl = pageUrlForSlug(p.slug)
  const [before, after] = await Promise.all([
    gscDeltaForPage(supabase, pageUrl, beforeStart, beforeEnd),
    gscDeltaForPage(supabase, pageUrl, afterStart, afterEnd),
  ])
  return {
    executed: true,
    target_id: p.id,
    clicks_before: before.clicks,
    clicks_after: after.clicks,
    position_before: before.position,
    position_after: after.position,
  }
}

// ─── resolveLinkSweepOutcome ───────────────────────────────────────────────

/**
 * For queue_internal_link_sweep: the execution_target_id is a Firestore
 * ai_jobs doc id. Read input.targetBlogPostId, then measure GSC for the
 * TARGET page (not the candidate posts — we want target lift) in 14-day
 * windows centered on the memo's run_date.
 */
export async function resolveLinkSweepOutcome(
  executionTargetId: string,
  runDateIso: string,
  supabase: SupabaseClient,
  firestore: Firestore,
): Promise<ResolvedOutcome> {
  const jobSnap = await firestore.collection("ai_jobs").doc(executionTargetId).get()
  if (!jobSnap.exists) {
    return { executed: true, target_id: null, error: "ai_job not found" }
  }
  // CONTRACT: `input.targetBlogPostId` is written by
  // functions/src/seo/execute.ts:executeQueueInternalLinkSweep. Field name
  // MUST match exactly across both sides.
  const job = jobSnap.data() as { input?: { targetBlogPostId?: string } } | undefined
  const targetId = job?.input?.targetBlogPostId
  if (!targetId) {
    return { executed: true, target_id: null, error: "ai_job missing input.targetBlogPostId" }
  }

  const { data: post, error: postErr } = await supabase
    .from("blog_posts")
    .select("id, slug")
    .eq("id", targetId)
    .maybeSingle()
  if (postErr) throw postErr
  if (!post) {
    return { executed: true, target_id: targetId, error: "target blog_post not found" }
  }
  const p = post as { id: string; slug: string }

  const beforeStart = isoDateOffset(runDateIso, -14)
  const beforeEnd = isoDateOffset(runDateIso, -1)
  const afterStart = isoDateOffset(runDateIso, 1)
  const afterEnd = isoDateOffset(runDateIso, 14)
  const pageUrl = pageUrlForSlug(p.slug)
  const [before, after] = await Promise.all([
    gscDeltaForPage(supabase, pageUrl, beforeStart, beforeEnd),
    gscDeltaForPage(supabase, pageUrl, afterStart, afterEnd),
  ])
  return {
    executed: true,
    target_id: p.id,
    clicks_before: before.clicks,
    clicks_after: after.clicks,
    position_before: before.position,
    position_after: after.position,
  }
}

// ─── resolveFlagOutcome ────────────────────────────────────────────────────

/**
 * For flag_for_human: the execution_target_id is a notifications row id.
 * Just check is_read.
 */
export async function resolveFlagOutcome(
  executionTargetId: string,
  supabase: SupabaseClient,
): Promise<ResolvedOutcome> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, is_read")
    .eq("id", executionTargetId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    return { executed: true, target_id: null, error: "notification not found" }
  }
  const row = data as { id: string; is_read: boolean }
  return { executed: true, target_id: row.id, acknowledged: row.is_read }
}
