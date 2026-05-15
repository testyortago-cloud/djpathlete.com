// functions/src/social-agent.ts
// Autonomous social-media agent. Unlike social-fanout (which is driven by a
// video transcript), this handler picks its own topic, drafts copy, and lands
// the result as draft social_posts in the admin approval queue.
//
// Multi-platform: each run generates one draft per platform that's currently
// `connected` in platform_connections. Reuses the same writer→reviewer
// pipeline social-fanout uses, so voice stays consistent across platforms.
//
// Pipeline:
//   1. Strategist — pick a published blog post (brief-aware via
//      pickTopicWithBrief, which also enforces brief.dont_do).
//   2. Determine targetPlatforms — explicit input.platform overrides;
//      otherwise the set of `connected` social platforms.
//   3. For each target platform:
//        a. Writer pass (voice_profile + social_caption[platform])
//        b. Reviewer pass (social_caption_reviewer)
//        c. Insert social_posts + social_captions
//      Per-platform failures are logged and skipped; the run continues.
//   4. One aggregate social_agent_memos row records all platforms.
//
// Input: { platform?: AgentPlatform; blogPostId?: string }
//   platform — if set, only that platform runs (overrides connection filter).
//   blogPostId — manual topic override.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"
import { fewShotsBlock } from "./lib/few-shots.js"
import { scoreBlogVsBrief } from "./strategy/brief-blog-scorer.js"

export const SUPPORTED_PLATFORMS = [
  "linkedin",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "youtube_shorts",
] as const
export type AgentPlatform = (typeof SUPPORTED_PLATFORMS)[number]

export interface SocialAgentInput {
  platform?: AgentPlatform
  blogPostId?: string
}

export interface BlogTopic {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: string | null
}

const captionSchema = z.object({
  caption_text: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
})
type Caption = z.infer<typeof captionSchema>

const reviewedCaptionSchema = z.object({
  revised_caption_text: z.string().min(1),
  revised_hashtags: z.array(z.string()).default([]),
  score: z.number().min(1).max(10),
  notes: z.string().default(""),
})
type ReviewedCaption = z.infer<typeof reviewedCaptionSchema>

// ─── Connected-platform filter ─────────────────────────────────────────────
// platform_connections.plugin_name uses the same string as social_caption.scope
// and SocialPost.platform — e.g. "linkedin", "tiktok". Status='connected' means
// OAuth tokens are valid; 'not_connected'/'paused'/'error' rows are skipped.
// gmail and google_ads rows exist in platform_connections but are filtered out
// by the SOCIAL_PLATFORMS allowlist.

export async function listConnectedSocialPlatforms(
  supabase: SupabaseClient,
): Promise<AgentPlatform[]> {
  const { data } = await supabase
    .from("platform_connections")
    .select("plugin_name, status")
    .in("plugin_name", SUPPORTED_PLATFORMS as unknown as string[])
    .eq("status", "connected")
  const rows = (data as Array<{ plugin_name: string; status: string }> | null) ?? []
  return rows
    .map((r) => r.plugin_name)
    .filter((name): name is AgentPlatform =>
      (SUPPORTED_PLATFORMS as readonly string[]).includes(name),
    )
}

// ─── Tool performance ──────────────────────────────────────────────────────
// Mirrors gatherToolPerformance from seo/signals.ts. Joins agent_tool_baselines
// (social channel) with a 90-day rollup of impact_score from measured
// social_agent_memos. Social only has one tool (drafted_social_post) today, so
// this is effectively the agent's historical engagement floor.

export interface SocialToolPerformanceEntry {
  tool: string
  n_measured: number
  avg_impact_score: number
  p95_abs_delta: number
  success_rate: number
}

export async function gatherSocialToolPerformance(
  supabase: SupabaseClient,
): Promise<SocialToolPerformanceEntry[]> {
  const { data: baselines } = await supabase
    .from("agent_tool_baselines")
    .select("tool_name, n_measured, p95_abs_delta, success_rate")
    .eq("channel", "social")
  if (!baselines || baselines.length === 0) return []

  const ninety = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const { data: memos } = await supabase
    .from("social_agent_memos")
    .select("actions, impact_score")
    .eq("outcome_status", "measured")
    .gte("run_date", ninety)

  const sumByTool: Record<string, { sum: number; count: number }> = {}
  for (const m of (memos ?? []) as Array<{
    actions: Array<{ kind: string }>
    impact_score: number | null
  }>) {
    if (m.impact_score == null) continue
    for (const a of m.actions ?? []) {
      // social_agent_memos.actions[i].kind is the tool name analog.
      sumByTool[a.kind] ??= { sum: 0, count: 0 }
      sumByTool[a.kind].sum += m.impact_score
      sumByTool[a.kind].count += 1
    }
  }

  return (
    baselines as Array<{
      tool_name: string
      n_measured: number
      p95_abs_delta: number
      success_rate: number
    }>
  ).map((b) => {
    const agg = sumByTool[b.tool_name] ?? { sum: 0, count: 0 }
    return {
      tool: b.tool_name,
      n_measured: b.n_measured,
      avg_impact_score: agg.count > 0 ? Math.round(agg.sum / agg.count) : 0,
      p95_abs_delta: b.p95_abs_delta,
      success_rate: b.success_rate,
    }
  })
}

export function buildSocialToolPerfBlock(entries: SocialToolPerformanceEntry[]): string {
  if (entries.length === 0) return ""
  return [
    "Tool performance (last 90 days, your channel):",
    ...entries.map(
      (t) =>
        `  ${t.tool}: avg impact ${t.avg_impact_score >= 0 ? "+" : ""}${t.avg_impact_score}, ${t.n_measured} runs, ${Math.round(t.success_rate * 100)}% success`,
    ),
    "",
  ].join("\n")
}

// ─── Tavily trending topics ────────────────────────────────────────────────
// The Tavily trending-scan cron (functions/src/tavily-trending-scan.ts) writes
// rows into `content_calendar` with entry_type='topic_suggestion' and
// metadata.source='tavily'. We surface the most recent batch to the social
// writer so it can flag a relevance gap when a trend matches the brief but
// no published blog covers it. Reader stays inline because functions/ has
// rootDir: "src" and can't import from lib/.

export interface TavilyTopicRow {
  id: string
  title: string
  metadata: {
    source?: string
    rank?: number
    tavily_url?: string
    summary?: string
  } | null
  created_at: string
}

export async function latestTavilyTopics(
  supabase: SupabaseClient,
  limit = 5,
  withinDays = 7,
): Promise<TavilyTopicRow[]> {
  const cutoff = new Date(Date.now() - withinDays * 86_400_000).toISOString()
  const { data } = await supabase
    .from("content_calendar")
    .select("id, title, metadata, created_at")
    .eq("entry_type", "topic_suggestion")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(limit * 3) // overfetch to allow post-filter on metadata.source
  const rows = (data as TavilyTopicRow[] | null) ?? []
  return rows.filter((r) => r.metadata?.source === "tavily").slice(0, limit)
}

export function buildTrendingBlock(topics: TavilyTopicRow[]): string {
  if (topics.length === 0) return ""
  return [
    "Trending topics this week (Tavily, ranked):",
    ...topics.map((t, i) => {
      const rank = t.metadata?.rank ?? i + 1
      const url = t.metadata?.tavily_url ? ` (${t.metadata.tavily_url})` : ""
      return `  ${i + 1}. ${t.title} — relevance rank ${rank}${url}`
    }),
    "",
    "If a trending topic aligns with brief themes or keywords_to_chase AND no blog covers it, note this in caption_text and suggest the editor consider a flag_trending_gap action.",
    "",
  ].join("\n")
}

// ─── Strategist ────────────────────────────────────────────────────────────
// Picks the topic. Deterministic — most recent published blog_post. If the
// user passed an explicit blogPostId we honor it. Duplicate-topic detection is
// out of scope for this phase; the admin approval queue catches dupes.

export async function pickTopic(args: {
  supabase: SupabaseClient
  blogPostId?: string
}): Promise<BlogTopic | null> {
  const { supabase, blogPostId } = args

  if (blogPostId) {
    const { data } = await supabase
      .from("blog_posts")
      .select("id, title, slug, excerpt, content")
      .eq("id", blogPostId)
      .maybeSingle()
    return (data as BlogTopic | null) ?? null
  }

  const { data: candidates } = await supabase
    .from("blog_posts")
    .select("id, title, slug, excerpt, content")
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(1)

  return ((candidates as BlogTopic[] | null) ?? [])[0] ?? null
}

// ─── Strategist (brief-aware) ──────────────────────────────────────────────
// `pickTopicWithBrief` is the new entry point: if there's a current approved
// strategy brief, it scores recent published posts against the brief's
// themes/keywords/hooks and picks the best match. Falls back to most-recent
// when no brief exists. Honors an explicit `blogPostId` override.

export interface MinimalBriefRow {
  id: string
  week_of: string
  themes: Array<{ tag: string; weight: number }>
  audience_focus: string
  priority_channel: "seo" | "ads" | "social" | "balanced"
  keywords_to_chase: string[]
  hooks_to_test: string[]
  ctas: string[]
  dont_do: string[]
}

async function fetchLatestApprovedBrief(
  supabase: SupabaseClient,
): Promise<MinimalBriefRow | null> {
  const { data } = await supabase
    .from("strategy_briefs")
    .select("*")
    .eq("approval_status", "approved")
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as MinimalBriefRow | null) ?? null
}

export async function pickTopicWithBrief(args: {
  supabase: SupabaseClient
  blogPostId?: string
}): Promise<{
  topic: BlogTopic | null
  brief: MinimalBriefRow | null
  alignmentScore: number | null
}> {
  const { supabase, blogPostId } = args
  if (blogPostId) {
    const topic = await pickTopic({ supabase, blogPostId })
    return { topic, brief: null, alignmentScore: null }
  }
  const brief = await fetchLatestApprovedBrief(supabase)
  const { data } = await supabase
    .from("blog_posts")
    .select("id, title, slug, excerpt, content")
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(20)
  const list = (data as BlogTopic[] | null) ?? []
  if (list.length === 0) return { topic: null, brief, alignmentScore: null }
  if (!brief) return { topic: list[0], brief: null, alignmentScore: null }

  const scored = list
    .map((c) => ({ c, score: scoreBlogVsBrief(c, brief) }))
    .sort((a, b) => b.score - a.score)
  // Drop any candidate the scorer flagged as -1 (matched a dont_do phrase).
  // If every candidate is blocked, signal "no eligible topic" so the handler
  // can write a memo + notify the coach instead of drafting a rejected post.
  const eligible = scored.filter((s) => s.score !== -1)
  if (eligible.length === 0) {
    return { topic: null, brief, alignmentScore: 1 }
  }
  const top = eligible[0]
  if (top.score === 0) return { topic: eligible[0].c, brief, alignmentScore: 1 }
  const max = eligible[0].score
  const min = eligible[eligible.length - 1]?.score ?? 0
  const norm =
    max === min
      ? 10
      : Math.max(1, Math.min(10, Math.round(((top.score - min) / (max - min)) * 9 + 1)))
  return { topic: top.c, brief, alignmentScore: norm }
}

// ─── Copywriter ────────────────────────────────────────────────────────────

export interface BuildCopywriterMessageInput {
  topic: BlogTopic
  platform: AgentPlatform
}

export function buildCopywriterUserMessage(input: BuildCopywriterMessageInput): string {
  const source = (input.topic.content ?? input.topic.excerpt ?? "").slice(0, 4000)
  return [
    `Platform: ${input.platform}`,
    `Source blog post title: ${input.topic.title}`,
    input.topic.excerpt ? `Source excerpt: ${input.topic.excerpt}` : "",
    "",
    "Source material (use as fact base, do not copy verbatim):",
    "---",
    source,
    "---",
    "",
    "Write the post for this platform. Return JSON only.",
  ]
    .filter((line) => line !== "")
    .join("\n")
}

export interface BuildReviewerMessageInput {
  platform: AgentPlatform
  writerRules: string
  draft: Caption
}

export function buildReviewerUserMessage(input: BuildReviewerMessageInput): string {
  return [
    `Platform: ${input.platform}`,
    "",
    "Writer rules the draft was supposed to follow:",
    "---",
    input.writerRules,
    "---",
    "",
    "DRAFT caption_text:",
    "---",
    input.draft.caption_text,
    "---",
    "",
    `DRAFT hashtags: ${input.draft.hashtags.join(", ") || "(none)"}`,
    "",
    "Review the draft against the rules above. Return your revision as JSON.",
  ].join("\n")
}

// ─── Per-platform draft helper ─────────────────────────────────────────────
// Encapsulates the writer + reviewer + persistence work for ONE platform so
// the handler can loop and collect results.

interface PromptRow {
  scope: string
  category: string
  prompt: string
  few_shot_examples?: unknown
}

function extractCaptionFewShots(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((e) => {
    if (typeof e === "string" && e.length > 0) return [e]
    if (e && typeof e === "object") {
      const caption = (e as { caption?: unknown }).caption
      if (typeof caption === "string" && caption.length > 0) return [caption]
    }
    return []
  })
}

export interface PlatformDraftResult {
  platform: AgentPlatform
  socialPostId: string
  reviewerScore: number
  notes: string
}

export interface PlatformDraftError {
  platform: AgentPlatform
  error: string
}

async function draftForPlatform(args: {
  supabase: SupabaseClient
  platform: AgentPlatform
  topic: BlogTopic
  voiceProfile: string
  platformPrompt: string
  reviewerPrompt: string
  toolPerfBlock: string
  trendingBlock: string
  fewShotsRendered: string
}): Promise<PlatformDraftResult | PlatformDraftError> {
  const {
    supabase,
    platform,
    topic,
    voiceProfile,
    platformPrompt,
    reviewerPrompt,
    toolPerfBlock,
    trendingBlock,
    fewShotsRendered,
  } = args

  try {
    // Writer pass
    const writerSystem = `${voiceProfile}\n\n---\n\n${platformPrompt}`
    const writerUserMessage =
      toolPerfBlock +
      fewShotsRendered +
      trendingBlock +
      buildCopywriterUserMessage({ topic, platform })
    const writer = await callAgent<Caption>(writerSystem, writerUserMessage, captionSchema, {
      model: MODEL_SONNET,
      maxTokens: 2000,
      cacheSystemPrompt: true,
    })

    // Reviewer pass
    const reviewed = await callAgent<ReviewedCaption>(
      reviewerPrompt,
      buildReviewerUserMessage({
        platform,
        writerRules: platformPrompt,
        draft: writer.content,
      }),
      reviewedCaptionSchema,
      { model: MODEL_SONNET, maxTokens: 2000, cacheSystemPrompt: true },
    )

    console.log(
      `[social-agent] ${platform} reviewer score=${reviewed.content.score} notes=${reviewed.content.notes}`,
    )

    const finalCaption: Caption = {
      caption_text: reviewed.content.revised_caption_text,
      hashtags: reviewed.content.revised_hashtags,
    }

    // Persist as draft
    const { data: post, error: postErr } = await supabase
      .from("social_posts")
      .insert({
        platform,
        content: finalCaption.caption_text,
        approval_status: "draft",
        post_type: "text",
      })
      .select()
      .single()
    if (postErr || !post) {
      return {
        platform,
        error: `social_posts insert failed: ${postErr?.message ?? "unknown"}`,
      }
    }

    await supabase.from("social_captions").insert({
      social_post_id: (post as { id: string }).id,
      caption_text: finalCaption.caption_text,
      hashtags: finalCaption.hashtags,
      version: 1,
    })

    return {
      platform,
      socialPostId: (post as { id: string }).id,
      reviewerScore: reviewed.content.score,
      notes: reviewed.content.notes || "writer+reviewer agreed",
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown"
    console.error(`[social-agent] ${platform} draft failed:`, message)
    return { platform, error: message }
  }
}

// ─── Handler ───────────────────────────────────────────────────────────────

export async function handleSocialAgentRun(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const supabase = getSupabase()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function failJob(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    const snap = await jobRef.get()
    const data = snap.data()
    if (!data) {
      await failJob("ai_jobs doc disappeared")
      return
    }
    const input = (data.input as SocialAgentInput | undefined) ?? {}

    // Determine target platforms.
    // - Explicit input.platform → that platform only (manual-trigger override).
    // - Otherwise: every platform currently `connected` in platform_connections.
    let targetPlatforms: AgentPlatform[]
    if (input.platform) {
      if (!(SUPPORTED_PLATFORMS as readonly string[]).includes(input.platform)) {
        await failJob(`Unsupported platform: ${input.platform}`)
        return
      }
      targetPlatforms = [input.platform]
    } else {
      targetPlatforms = await listConnectedSocialPlatforms(supabase)
      if (targetPlatforms.length === 0) {
        await failJob(
          "No social platforms are connected. Connect at least one in /admin/integrations.",
        )
        return
      }
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    // 1. Strategist
    const { topic, brief, alignmentScore } = await pickTopicWithBrief({
      supabase,
      blogPostId: input.blogPostId,
    })
    if (!topic) {
      // Distinguish two empty-result cases:
      //   a) No published blog posts at all (or no brief + nothing recent) →
      //      hard failure so the coach sees this isn't an agent decision.
      //   b) A brief exists AND every recent post matched a dont_do phrase →
      //      record a "no_eligible_topic" memo, notify the coach, and mark
      //      the job completed-but-skipped. Not a failure — the agent
      //      correctly chose not to draft. pickTopicWithBrief flags this
      //      case with alignmentScore=1; alignmentScore=null means there
      //      simply weren't any published posts to consider.
      if (brief && alignmentScore === 1) {
        const runDate = new Date().toISOString().slice(0, 10)
        await supabase.from("social_agent_memos").insert({
          run_date: runDate,
          ai_job_id: jobId,
          brief_id: brief.id,
          brief_alignment_score: null,
          ran_without_brief: false,
          signals_summary: { reason: "all_candidates_rejected_by_dont_do" },
          actions: [
            {
              kind: "no_eligible_topic",
              payload: { brief_id: brief.id },
              rationale: "no candidate cleared dont_do filter",
            },
          ],
          rationale: "All recent published posts matched brief.dont_do.",
          outcome_status: "no_op",
          outcome_metrics: null,
          social_post_id: null,
          platform: null,
          agent_confidence: 1,
          dissents_from_brief: false,
          dissent_reason: null,
        })
        // Notify the coach (admin) — mirrors executeFlagForHuman shape.
        const { data: admins } = await supabase
          .from("profiles")
          .select("id")
          .eq("role", "admin")
          .limit(1)
        const adminId = (admins as Array<{ id: string }> | null)?.[0]?.id
        if (adminId) {
          await supabase.from("notifications").insert({
            user_id: adminId,
            type: "warning",
            title: "Social agent could not find an eligible topic",
            message: `All recent published posts matched the brief's dont_do filter. Brief id: ${brief.id}`,
            link: "/admin/social-agent/memos",
            is_read: false,
          })
        }
        await jobRef.update({
          status: "completed",
          error: null,
          result: { skipped: "no_eligible_topic", brief_id: brief.id },
          updatedAt: FieldValue.serverTimestamp(),
        })
        return
      }
      await failJob("Strategist found no published blog post to draft from")
      return
    }
    console.log(
      `[social-agent] platforms=[${targetPlatforms.join(",")}] topic=${topic.slug} brief=${brief?.id ?? "none"} alignment=${alignmentScore ?? "n/a"}`,
    )

    // 2. Load prompt rows — voice profile + reviewer + every per-platform
    //    writer row. Each platform's row also carries its own
    //    few_shot_examples populated by the performance-learning-loop.
    const { data: prompts, error: pErr } = await supabase
      .from("prompt_templates")
      .select("scope, category, prompt, few_shot_examples")
      .in("category", ["voice_profile", "social_caption", "social_caption_reviewer"])
    if (pErr || !prompts) {
      await failJob(`Could not load prompt templates: ${pErr?.message ?? "unknown"}`)
      return
    }
    const promptRows = prompts as PromptRow[]
    const voiceProfile = promptRows.find((p) => p.category === "voice_profile")?.prompt
    const reviewerPrompt = promptRows.find((p) => p.category === "social_caption_reviewer")
      ?.prompt
    if (!voiceProfile) return failJob("No voice_profile prompt_template row found")
    if (!reviewerPrompt) return failJob("No social_caption_reviewer prompt_template row found")

    // 3. Tool performance + trending blocks — same for every platform in
    //    this run, so compute once.
    const socialToolPerf = await gatherSocialToolPerformance(supabase)
    const toolPerfBlock = buildSocialToolPerfBlock(socialToolPerf)
    const trendingTopics = await latestTavilyTopics(supabase, 5, 7)
    const trendingBlock = buildTrendingBlock(trendingTopics)

    // 4. Loop over target platforms — independent per-platform try/catch
    //    inside draftForPlatform, so one platform's failure doesn't kill the
    //    others.
    const results: Array<PlatformDraftResult | PlatformDraftError> = []
    for (const platform of targetPlatforms) {
      const writerRow = promptRows.find(
        (p) => p.category === "social_caption" && p.scope === platform,
      )
      if (!writerRow?.prompt) {
        results.push({
          platform,
          error: `No social_caption prompt seeded for scope=${platform}`,
        })
        continue
      }
      const fewShotsRendered = fewShotsBlock(extractCaptionFewShots(writerRow.few_shot_examples))
      const r = await draftForPlatform({
        supabase,
        platform,
        topic,
        voiceProfile,
        platformPrompt: writerRow.prompt,
        reviewerPrompt,
        toolPerfBlock,
        trendingBlock,
        fewShotsRendered,
      })
      results.push(r)
    }

    const succeeded = results.filter(
      (r): r is PlatformDraftResult => !("error" in r),
    )
    const failures = results.filter((r): r is PlatformDraftError => "error" in r)

    if (succeeded.length === 0) {
      await failJob(
        `All platforms failed: ${failures.map((f) => `${f.platform}: ${f.error}`).join("; ")}`,
      )
      return
    }

    // 5. Aggregate memo — one row per run, one action per succeeded platform.
    //    social_post_id and platform on the memo row are null going forward;
    //    per-post linkage lives in actions[i].payload.social_post_id. The
    //    outcome tracker reads from there.
    const avgScore =
      succeeded.reduce((sum, r) => sum + r.reviewerScore, 0) / succeeded.length
    await supabase.from("social_agent_memos").insert({
      run_date: new Date().toISOString().slice(0, 10),
      ai_job_id: jobId,
      brief_id: brief?.id ?? null,
      brief_alignment_score: alignmentScore,
      ran_without_brief: brief === null,
      signals_summary: {
        topic_slug: topic.slug,
        platforms: succeeded.map((r) => r.platform),
        failed_platforms: failures.map((f) => f.platform),
      },
      actions: succeeded.map((r) => ({
        kind: "drafted_social_post",
        payload: { social_post_id: r.socialPostId, platform: r.platform, blog_post_id: topic.id },
        rationale: r.notes,
      })),
      rationale:
        failures.length === 0
          ? `drafted ${succeeded.length} platform${succeeded.length === 1 ? "" : "s"}`
          : `drafted ${succeeded.length} platform${succeeded.length === 1 ? "" : "s"}; ${failures.length} failed`,
      outcome_status: "pending",
      outcome_metrics: null,
      social_post_id: null,
      platform: null,
      agent_confidence: Math.round(avgScore),
      dissents_from_brief: false,
      dissent_reason: null,
    })

    await jobRef.update({
      status: "completed",
      error: null,
      result: {
        platforms: succeeded.map((r) => ({
          platform: r.platform,
          social_post_id: r.socialPostId,
          reviewer_score: r.reviewerScore,
        })),
        failed_platforms: failures.map((f) => ({ platform: f.platform, error: f.error })),
        blog_post_id: topic.id,
        brief_id: brief?.id ?? null,
        brief_alignment_score: alignmentScore,
        agent_confidence: Math.round(avgScore),
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown social-agent error")
  }
}
