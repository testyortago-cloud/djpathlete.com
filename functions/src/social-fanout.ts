// functions/src/social-fanout.ts
// Firebase Function: given a videoUploadId whose transcript is available,
// generates one platform-specific social caption for each of the 6 platforms
// (facebook, instagram, tiktok, youtube, youtube_shorts, linkedin) and
// persists them as social_posts + social_captions rows in Supabase.
//
// Each caption goes through a 2-pass pipeline:
//   1. Writer agent  — drafts a caption from the transcript using a
//      platform-specific writer prompt + the brand voice profile.
//   2. Reviewer agent — reviews the draft against the platform rules and
//      returns a publication-ready revision plus a 1-10 quality score and
//      change notes. The revised caption is what gets persisted.
//
// The reviewer is a generic global prompt; the platform's writer rules are
// injected into the user message so one prompt covers all 6 platforms.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"

const PLATFORMS = ["facebook", "instagram", "tiktok", "youtube", "youtube_shorts", "linkedin"] as const
type SocialPlatform = (typeof PLATFORMS)[number]

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

export interface SocialFanoutInput {
  videoUploadId: string
}

export interface BuildUserMessageInput {
  transcript: string
  platform: SocialPlatform
  videoTitle: string | null
}

export function buildUserMessage(input: BuildUserMessageInput): string {
  return [
    `Platform: ${input.platform}`,
    `Video title: ${input.videoTitle ?? "(untitled)"}`,
    "",
    "Video transcript:",
    "---",
    input.transcript,
    "---",
    "",
    "Generate the caption according to the platform style above. Return JSON only.",
  ].join("\n")
}

export interface BuildReviewMessageInput {
  platform: SocialPlatform
  writerRules: string
  draft: Caption
}

export function buildReviewMessage(input: BuildReviewMessageInput): string {
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

export async function handleSocialFanout(jobId: string): Promise<void> {
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
    const videoUploadId = (data.input as SocialFanoutInput | undefined)?.videoUploadId
    if (!videoUploadId) {
      await failJob("input.videoUploadId is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    // 1. Load transcript
    const { data: transcript, error: tErr } = await supabase
      .from("video_transcripts")
      .select("transcript_text")
      .eq("video_upload_id", videoUploadId)
      .maybeSingle()
    if (tErr || !transcript) {
      await failJob(`No transcript found for video ${videoUploadId}`)
      return
    }

    // 2. Load video title
    const { data: video } = await supabase
      .from("video_uploads")
      .select("title, original_filename")
      .eq("id", videoUploadId)
      .maybeSingle()
    const videoTitle = video?.title ?? video?.original_filename ?? null

    // 3. Load voice profile + per-platform writer prompts + reviewer prompt
    const { data: prompts, error: pErr } = await supabase
      .from("prompt_templates")
      .select("scope, category, prompt")
      .in("category", ["voice_profile", "social_caption", "social_caption_reviewer"])
    if (pErr || !prompts) {
      await failJob(`Could not load prompt templates: ${pErr?.message ?? "unknown"}`)
      return
    }

    const voiceProfile = prompts.find((p) => p.category === "voice_profile")?.prompt
    if (!voiceProfile) {
      await failJob("No voice_profile prompt_template row found")
      return
    }
    const reviewerPrompt = prompts.find((p) => p.category === "social_caption_reviewer")?.prompt
    if (!reviewerPrompt) {
      await failJob("No social_caption_reviewer prompt_template row found")
      return
    }
    const byPlatform = new Map<string, string>()
    for (const p of prompts) {
      if (p.category === "social_caption") byPlatform.set(p.scope, p.prompt)
    }

    // 4. For each platform: writer pass → reviewer pass. Run platforms in
    //    parallel; within a platform the two passes are sequential (reviewer
    //    needs the writer's draft). Captions start in "draft" state regardless
    //    of platform connection — the user reviews and approves/schedules.
    const results = await Promise.allSettled(
      PLATFORMS.map(async (platform) => {
        const platformPrompt = byPlatform.get(platform)
        if (!platformPrompt) throw new Error(`No social_caption prompt seeded for scope=${platform}`)

        // ── Writer pass ────────────────────────────────────────────────
        const writerSystem = `${voiceProfile}\n\n---\n\n${platformPrompt}`
        const writerUserMessage = buildUserMessage({
          transcript: transcript.transcript_text,
          platform,
          videoTitle,
        })

        const writer = await callAgent<Caption>(writerSystem, writerUserMessage, captionSchema, {
          model: MODEL_SONNET,
          maxTokens: 2000,
          cacheSystemPrompt: true,
        })

        // ── Reviewer pass ──────────────────────────────────────────────
        const reviewerUserMessage = buildReviewMessage({
          platform,
          writerRules: platformPrompt,
          draft: writer.content,
        })

        const reviewed = await callAgent<ReviewedCaption>(
          reviewerPrompt,
          reviewerUserMessage,
          reviewedCaptionSchema,
          {
            model: MODEL_SONNET,
            maxTokens: 2000,
            cacheSystemPrompt: true,
          },
        )

        console.log(
          `[social-fanout] ${platform} reviewer score=${reviewed.content.score} notes=${reviewed.content.notes}`,
        )

        const finalCaption: Caption = {
          caption_text: reviewed.content.revised_caption_text,
          hashtags: reviewed.content.revised_hashtags,
        }

        return { platform, caption: finalCaption }
      }),
    )

    // 5. Persist successes
    const created: Array<{ platform: SocialPlatform; social_post_id: string }> = []
    for (const r of results) {
      if (r.status !== "fulfilled") continue
      const { platform, caption } = r.value as { platform: SocialPlatform; caption: Caption }

      const { data: post, error: postErr } = await supabase
        .from("social_posts")
        .insert({
          platform,
          content: caption.caption_text,
          approval_status: "draft",
          source_video_id: videoUploadId,
        })
        .select()
        .single()
      if (postErr || !post) continue

      await supabase.from("social_captions").insert({
        social_post_id: post.id,
        caption_text: caption.caption_text,
        hashtags: caption.hashtags,
        version: 1,
      })

      created.push({ platform, social_post_id: post.id })
    }

    const failedPlatforms = results
      .map((r, i) => (r.status === "rejected" ? PLATFORMS[i] : null))
      .filter(Boolean) as string[]

    await jobRef.update({
      status: created.length > 0 ? "completed" : "failed",
      error: failedPlatforms.length > 0 ? `Platforms that failed: ${failedPlatforms.join(", ")}` : null,
      result: { videoUploadId, created, failedPlatforms },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown social fanout error")
  }
}
