import Anthropic from "@anthropic-ai/sdk"
import { MODEL_HAIKU } from "../ai/anthropic.js"

// Anything strictly below this triggers one regeneration on a fresh seed.
export const QUALITY_RETRY_THRESHOLD = 7

const ALLOWED_MEDIA_TYPES = ["image/webp", "image/png", "image/jpeg"] as const
type AllowedMediaType = typeof ALLOWED_MEDIA_TYPES[number]

const SYSTEM = `You are a brutally honest photo editor reviewing a generated image against DJP Athlete's brand rubric.

Score 1-10 against this rubric (each is a deduction risk, not a checklist):
- Photorealism (no plastic skin, no porcelain faces, no AI-art artifacts)
- Anatomical correctness (hands, fingers, eyes, limbs)
- Documentary athletic feel (mid-action, not posed; real gym/field setting)
- Color grade (muted, warm-leaning, NOT oversaturated or HDR)
- Composition (subject crisp, background gentle blur, rule of thirds)
- On-brief (matches the original prompt's intent)
- No forbidden elements (no text, no logos, no neon rim light, no flares, no CGI look)

Score guide:
- 10: publishable in a magazine, indistinguishable from a real shoot
- 8-9: ship it, minor nitpicks
- 7: borderline ship — small issues a careful reader would clock
- 5-6: visibly AI — retry recommended
- 1-4: broken — must retry

Output strict JSON, nothing else:
{ "score": <1-10 integer>, "reasons": ["<short, specific>", ...] }`

interface JudgeInput {
  buffer: Buffer
  mime: string
  originalPrompt: string
}

export interface JudgeResult {
  score: number
  reasons: string[]
  judge_failed: boolean
}

export async function judgeImageQuality(input: JudgeInput): Promise<JudgeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set")
  const client = new Anthropic({ apiKey })

  const mediaType: AllowedMediaType = (ALLOWED_MEDIA_TYPES as readonly string[]).includes(input.mime)
    ? (input.mime as AllowedMediaType)
    : "image/webp"

  const response = await client.messages.create({
    model: MODEL_HAIKU,
    max_tokens: 400,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: input.buffer.toString("base64") } },
          { type: "text", text: `Original prompt the model was given:\n${input.originalPrompt}\n\nScore this image and output the JSON.` },
        ],
      },
    ],
  })

  const textBlock = response.content.find((b: { type: string }) => b.type === "text") as
    | { type: "text"; text: string }
    | undefined
  const raw = textBlock && "text" in textBlock ? textBlock.text : ""

  try {
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { score: number; reasons: string[] }
    const score = Math.max(1, Math.min(10, Math.round(parsed.score)))
    return { score, reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 8) : [], judge_failed: false }
  } catch {
    return { score: 0, reasons: ["judge response unparseable"], judge_failed: true }
  }
}
