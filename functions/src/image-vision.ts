import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { getStorage } from "firebase-admin/storage"
import Anthropic from "@anthropic-ai/sdk"
import { getSupabase } from "./lib/supabase.js"
import { generateAltText } from "./lib/image-alt-text.js"

const MODEL = "claude-sonnet-4-6"

const ANALYSIS_SYSTEM_PROMPT = `You are analyzing a photograph for a fitness/coaching content team. Return ONLY a JSON object:
{
  "scene": "gym" | "home" | "outdoor" | "stage" | "studio" | "other",
  "objects": ["<notable object>", "..."],
  "suggested_hashtags": ["<tag>", "..."]
}
Rules:
- objects: max 8, name visible equipment, people, props. Skip walls/floor.
- suggested_hashtags: max 5, lowercase, single-word, no '#'.
Return nothing except the JSON object.`

interface ParsedAnalysis {
  scene: string
  objects: string[]
  suggested_hashtags: string[]
}

function safeParseAnalysis(raw: string): ParsedAnalysis | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    const parsed = JSON.parse(cleaned) as Partial<ParsedAnalysis>
    return {
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

export interface ImageVisionInput {
  mediaAssetId: string
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

    const { data: asset, error } = await supabase
      .from("media_assets")
      .select("id, storage_path, mime_type")
      .eq("id", mediaAssetId)
      .single()
    if (error || !asset) {
      await failJob(`media_assets row ${mediaAssetId} not found`)
      return
    }

    const bucket = getStorage().bucket()
    const [buffer] = await bucket.file(asset.storage_path).download()
    const mimeType = (asset.mime_type as string | null) ?? "image/jpeg"

    // Alt text via shared helper
    const altText = await generateAltText(buffer, mimeType)

    // Structured analysis via inline Claude call
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type:
                  (mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif") ??
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
    const analysis = textBlock && textBlock.type === "text" ? safeParseAnalysis(textBlock.text) : null

    await supabase
      .from("media_assets")
      .update({
        ai_alt_text: altText,
        ai_analysis: analysis ?? { scene: "other", objects: [], suggested_hashtags: [] },
      })
      .eq("id", mediaAssetId)

    await jobRef.update({
      status: "completed",
      result: { mediaAssetId, alt_text: altText },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    await failJob((err as Error).message ?? "Unknown image-vision error")
  }
}
