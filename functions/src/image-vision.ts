// functions/src/image-vision.ts
// Vision-based alt-text generator for image assets. Runs when a new image
// arrives in media_assets (triggered via ai_jobs/{id} with type=image_vision).
// Downloads the image from Firebase Storage, sends to Claude Sonnet 4.6 with
// vision enabled, and writes the parsed alt_text + analysis back to the
// media_assets row.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { getStorage } from "firebase-admin/storage"
import Anthropic from "@anthropic-ai/sdk"
import { getSupabase } from "./lib/supabase.js"

const MODEL = "claude-sonnet-4-6"
const ALT_TEXT_MAX_CHARS = 180

const VISION_SYSTEM_PROMPT = `You are analyzing a single photograph for a fitness / coaching content team. Your output will populate the image's accessibility alt-text and help the team tag the image for search.

Return ONLY a JSON object with this exact shape:
{
  "alt_text": "<one concrete sentence, <= 125 chars, describes what a blind user needs to know>",
  "scene": "gym" | "home" | "outdoor" | "stage" | "studio" | "other",
  "objects": ["<notable object>", "..."],  // max 8 items
  "suggested_hashtags": ["<tag>", "..."]    // max 5 items, no '#' prefix, lowercase, single word each
}

Rules:
- alt_text: be specific, use fitness terminology ("barbell back squat", "band pull-apart") when the exercise is identifiable. Avoid filler like "photo of" or "image shows".
- scene: pick the best single match; use "other" only if none fit.
- objects: name visible equipment, people, props. Skip the background (walls, floor).
- suggested_hashtags: concrete and relevant — "strength", "squats", "coaching" — not generic "fitness" unless the image is truly that broad.
- If the image is unusable (blurry, corrupted, empty), return alt_text="" and objects=[].

Return nothing except the JSON object — no preamble, no markdown fence.`

export interface ImageVisionInput {
  mediaAssetId: string
}

interface ParsedVision {
  alt_text: string
  scene: string
  objects: string[]
  suggested_hashtags: string[]
}

function safeParseVision(raw: string): ParsedVision | null {
  try {
    // Strip any stray markdown fence the model occasionally emits despite instructions.
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    const parsed = JSON.parse(cleaned) as Partial<ParsedVision>
    if (typeof parsed.alt_text !== "string") return null
    return {
      alt_text: parsed.alt_text.slice(0, ALT_TEXT_MAX_CHARS),
      scene: typeof parsed.scene === "string" ? parsed.scene : "other",
      objects: Array.isArray(parsed.objects)
        ? parsed.objects.filter((x): x is string => typeof x === "string").slice(0, 8)
        : [],
      suggested_hashtags: Array.isArray(parsed.suggested_hashtags)
        ? parsed.suggested_hashtags.filter((x): x is string => typeof x === "string").slice(0, 5)
        : [],
    }
  } catch {
    return null
  }
}

export async function handleImageVision(jobId: string): Promise<void> {
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
    const mediaAssetId = (data.input as ImageVisionInput | undefined)?.mediaAssetId
    if (!mediaAssetId) {
      await failJob("input.mediaAssetId is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    // Load the asset row so we know where to fetch bytes from.
    const { data: asset, error } = await supabase
      .from("media_assets")
      .select("id, storage_path, mime_type")
      .eq("id", mediaAssetId)
      .single()
    if (error || !asset) {
      await failJob(`media_assets row ${mediaAssetId} not found`)
      return
    }

    // Download the image bytes.
    const bucket = getStorage().bucket()
    const [buffer] = await bucket.file(asset.storage_path).download()

    // Call Claude Vision.
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: VISION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type:
                  (asset.mime_type as "image/jpeg" | "image/png" | "image/webp" | "image/gif") ??
                  "image/jpeg",
                data: buffer.toString("base64"),
              },
            },
            { type: "text", text: "Analyze this image per the system instructions." },
          ],
        },
      ],
    })

    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      await failJob("Claude returned no text block for image vision")
      return
    }

    const parsed = safeParseVision(textBlock.text)
    if (!parsed) {
      await failJob("Claude response did not parse as valid JSON")
      return
    }

    // Write to media_assets. ai_alt_text is the accessibility string; ai_analysis
    // holds the structured breakdown for future use (search filters, auto-tagging).
    await supabase
      .from("media_assets")
      .update({
        ai_alt_text: parsed.alt_text,
        ai_analysis: {
          scene: parsed.scene,
          objects: parsed.objects,
          suggested_hashtags: parsed.suggested_hashtags,
        },
      })
      .eq("id", mediaAssetId)

    await jobRef.update({
      status: "completed",
      result: { mediaAssetId, alt_text: parsed.alt_text },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    await failJob((err as Error).message ?? "Unknown image-vision error")
  }
}
