// functions/src/social-agent.ts
// Autonomous social-media agent. Unlike social-fanout (which is driven by a
// video transcript), this handler picks its own topic, drafts copy, and lands
// the result as a draft social_post in the admin approval queue.
//
// Pipeline:
//   1. Strategist — pick a published blog post that has no LinkedIn social_post
//      in the last 60 days. Falls back to the most recent published post.
//   2. Copywriter — writer pass (voice_profile + social_caption[linkedin]) then
//      reviewer pass (social_caption_reviewer). Same prompt rows social-fanout
//      uses, so voice stays consistent.
//
// Output: one social_posts row (platform=linkedin, approval_status=draft) and
// a matching social_captions row. No publishing happens here.
//
// Input: { platform?: "linkedin"; blogPostId?: string } — optional overrides.
// Platform is fixed to linkedin in this phase; passing other values is a noop.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"
import { scoreBlogVsBrief } from "./strategy/brief-blog-scorer.js"

export const SUPPORTED_PLATFORMS = ["linkedin"] as const
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
  const top = scored[0]
  if (top.score === 0) return { topic: list[0], brief, alignmentScore: 1 }
  const max = scored[0].score
  const min = scored[scored.length - 1]?.score ?? 0
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
    const platform: AgentPlatform = input.platform ?? "linkedin"
    if (!SUPPORTED_PLATFORMS.includes(platform)) {
      await failJob(`Unsupported platform: ${platform}`)
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    // 1. Strategist
    const { topic, brief, alignmentScore } = await pickTopicWithBrief({
      supabase,
      blogPostId: input.blogPostId,
    })
    if (!topic) {
      await failJob("Strategist found no published blog post to draft from")
      return
    }
    console.log(
      `[social-agent] platform=${platform} topic=${topic.slug} brief=${brief?.id ?? "none"} alignment=${alignmentScore ?? "n/a"}`,
    )

    // 2. Load prompt rows — same shape social-fanout uses.
    const { data: prompts, error: pErr } = await supabase
      .from("prompt_templates")
      .select("scope, category, prompt")
      .in("category", ["voice_profile", "social_caption", "social_caption_reviewer"])
    if (pErr || !prompts) {
      await failJob(`Could not load prompt templates: ${pErr?.message ?? "unknown"}`)
      return
    }
    const voiceProfile = prompts.find((p) => p.category === "voice_profile")?.prompt
    const reviewerPrompt = prompts.find((p) => p.category === "social_caption_reviewer")?.prompt
    const platformPrompt = prompts.find(
      (p) => p.category === "social_caption" && p.scope === platform,
    )?.prompt
    if (!voiceProfile) return failJob("No voice_profile prompt_template row found")
    if (!reviewerPrompt) return failJob("No social_caption_reviewer prompt_template row found")
    if (!platformPrompt) return failJob(`No social_caption prompt seeded for scope=${platform}`)

    // 3. Writer pass
    const writerSystem = `${voiceProfile}\n\n---\n\n${platformPrompt}`
    const writer = await callAgent<Caption>(
      writerSystem,
      buildCopywriterUserMessage({ topic, platform }),
      captionSchema,
      { model: MODEL_SONNET, maxTokens: 2000, cacheSystemPrompt: true },
    )

    // 4. Reviewer pass
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

    // 5. Persist as draft
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
      await failJob(`social_posts insert failed: ${postErr?.message ?? "unknown"}`)
      return
    }

    await supabase.from("social_captions").insert({
      social_post_id: post.id,
      caption_text: finalCaption.caption_text,
      hashtags: finalCaption.hashtags,
      version: 1,
    })

    // 6. Memo — record what the strategist did this run so the chief can
    // audit how the brief shaped the draft. Inline insert (no DAL import).
    await supabase.from("social_agent_memos").insert({
      run_date: new Date().toISOString().slice(0, 10),
      ai_job_id: jobId,
      brief_id: brief?.id ?? null,
      brief_alignment_score: alignmentScore,
      ran_without_brief: brief === null,
      signals_summary: { topic_slug: topic.slug, platform },
      actions: [
        {
          kind: "drafted_social_post",
          payload: { social_post_id: post.id, platform, blog_post_id: topic.id },
          rationale: reviewed.content.notes || "writer+reviewer agreed",
        },
      ],
      rationale: reviewed.content.notes || "",
      outcome_status: "pending",
      outcome_metrics: null,
      social_post_id: post.id,
      platform,
      agent_confidence: reviewed.content.score,
      dissents_from_brief: false,
      dissent_reason: null,
    })

    await jobRef.update({
      status: "completed",
      error: null,
      result: {
        platform,
        social_post_id: post.id,
        blog_post_id: topic.id,
        reviewer_score: reviewed.content.score,
        brief_id: brief?.id ?? null,
        brief_alignment_score: alignmentScore,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown social-agent error")
  }
}
