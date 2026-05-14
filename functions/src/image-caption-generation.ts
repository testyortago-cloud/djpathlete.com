import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { getStorage } from "firebase-admin/storage"
import Anthropic from "@anthropic-ai/sdk"
import { getSupabase } from "./lib/supabase.js"
import {
  buildCaptionPrompt,
  type CaptionPlatform,
} from "./lib/image-caption-prompts.js"

const MODEL = "claude-sonnet-4-6"
const MAX_TOKENS = 800

const PLATFORM_MAX: Record<CaptionPlatform, number> = {
  instagram: 2200,
  facebook: 5000,
  tiktok: 2200,
  linkedin: 3000,
}

const HASHTAG_RE = /^[a-z0-9_]{1,30}$/

interface JobInput {
  socialPostId?: string
  platform?: CaptionPlatform
  mediaAssetIds?: string[]
  force?: boolean
}

interface ParsedCaption {
  caption: string
  hashtags: string[]
  cta: string | null
}

function safeParse(raw: string): ParsedCaption | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    const parsed = JSON.parse(cleaned) as Partial<ParsedCaption>
    if (typeof parsed.caption !== "string") return null
    return {
      caption: parsed.caption,
      hashtags: Array.isArray(parsed.hashtags)
        ? parsed.hashtags.filter((x): x is string => typeof x === "string" && HASHTAG_RE.test(x))
        : [],
      cta: typeof parsed.cta === "string" ? parsed.cta : null,
    }
  } catch {
    return null
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + "…"
}

export async function handleImageCaptionGeneration(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const supabase = getSupabase()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function fail(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    const snap = await jobRef.get()
    const data = snap.data()
    if (!data) return await fail("ai_jobs doc disappeared")

    const input = (data.input ?? {}) as JobInput
    const { socialPostId, platform, mediaAssetIds } = input
    if (!socialPostId) return await fail("input.socialPostId is required")
    if (!platform) return await fail("input.platform is required")
    if (!mediaAssetIds || mediaAssetIds.length === 0)
      return await fail("input.mediaAssetIds must be non-empty")

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const { data: assets, error } = await supabase
      .from("media_assets")
      .select("id, storage_path, mime_type")
      .eq("kind", "image")
      .in("id", mediaAssetIds)
    if (error || !assets || assets.length === 0)
      return await fail(`media_assets not found for ${mediaAssetIds.join(",")}`)

    // Preserve mediaAssetIds order in the prompt.
    const byId = new Map(assets.map((a) => [a.id as string, a]))
    const ordered = mediaAssetIds.map((id) => byId.get(id)).filter(Boolean) as Array<{
      id: string
      storage_path: string
      mime_type: string
    }>

    const bucket = getStorage().bucket()
    const imageBlocks = await Promise.all(
      ordered.map(async (a) => {
        const [buf] = await bucket.file(a.storage_path).download()
        const mt = (a.mime_type as "image/jpeg" | "image/png" | "image/webp") ?? "image/jpeg"
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: mt,
            data: buf.toString("base64"),
          },
        }
      }),
    )

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
    const client = new Anthropic({ apiKey })

    const system = buildCaptionPrompt(platform, ordered.length)
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text", text: "Write the caption per the system instructions." },
          ],
        },
      ],
    })

    const textBlock = response.content.find((b) => b.type === "text")
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : ""
    const parsed = safeParse(raw)
    if (!parsed) return await fail("Could not parse caption JSON from model")

    const caption = truncate(parsed.caption.trim(), PLATFORM_MAX[platform])
    const hashtagsLine = parsed.hashtags.length > 0
      ? "\n\n" + parsed.hashtags.map((h) => `#${h}`).join(" ")
      : ""
    const fullCaption = truncate(caption + hashtagsLine, PLATFORM_MAX[platform])

    const { error: updateErr } = await supabase
      .from("social_posts")
      .update({
        content: fullCaption,
        metadata: {
          image_caption_job_id: jobId,
          image_caption_hashtags: parsed.hashtags,
          image_caption_cta: parsed.cta,
          ai_generated_at: new Date().toISOString(),
        },
      })
      .eq("id", socialPostId)
    if (updateErr) return await fail(`Failed to write caption to social_posts: ${updateErr.message}`)

    await jobRef.update({
      status: "completed",
      result: { socialPostId, captionLength: fullCaption.length, hashtagCount: parsed.hashtags.length },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    await fail((err as Error).message ?? "Unknown image-caption error")
  }
}
