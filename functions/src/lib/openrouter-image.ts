import { OPENROUTER_BASE_URL } from "../ai/openrouter.js"

/**
 * Image generation through OpenRouter's images endpoint.
 *
 * MEASURED 2026-09-23 against a live key, not assumed:
 *   - GPT Image models 404 on /chat/completions ("image generation model and
 *     cannot be used with the chat/completions endpoint") — they are ONLY
 *     reachable at /images/generations, OpenAI-compatible shape.
 *   - The response is `data[0].b64_json` + `data[0].media_type`; there is no URL
 *     to download and no seed.
 *   - `size` takes arbitrary dimensions, but BOTH must be divisible by 16 —
 *     "2400x1260" 400s. `toSize` rounds, and the pipeline's cover-crop absorbs
 *     the few pixels of difference.
 *   - openai/gpt-image-2.5-sunburst at 2048x1152: ~20s, ~$0.005.
 */

// A genuine render at our smallest size is megabytes of PNG. Anything this
// small is a placeholder or a truncated payload, never an image to publish.
const MIN_REAL_IMAGE_BYTES = 5_000

export interface GenerateOpenRouterImageInput {
  model: string
  prompt: string
  width: number
  height: number
  signal?: AbortSignal
}

export interface GenerateOpenRouterImageResult {
  buffer: Buffer
  mime: string
  /** OpenRouter returns no seed. 0 keeps the stored image records' shape. */
  seed: number
}

interface ImagesResponse {
  data?: Array<{ b64_json?: string; media_type?: string }>
  error?: { message?: string; code?: number; metadata?: { raw?: string; provider_name?: string } }
}

export function toSize(width: number, height: number): string {
  const r = (n: number) => Math.max(16, Math.round(n / 16) * 16)
  return `${r(width)}x${r(height)}`
}

export async function generateOpenRouterImage(
  input: GenerateOpenRouterImageInput,
): Promise<GenerateOpenRouterImageResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set")

  const res = await fetch(`${OPENROUTER_BASE_URL}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: input.model, prompt: input.prompt, n: 1, size: toSize(input.width, input.height) }),
    signal: input.signal,
  })

  const body = (await res.json().catch(() => ({}))) as ImagesResponse
  if (!res.ok || body.error) {
    // OpenRouter's top-level message is often just "Provider returned error";
    // the reason that matters is in metadata.raw. Surface both.
    const raw = body.error?.metadata?.raw ? ` — ${body.error.metadata.raw.slice(0, 300)}` : ""
    throw new Error(
      `OpenRouter image ${res.status} (${input.model}): ${body.error?.message ?? "no error body"}${raw}`,
    )
  }

  const first = body.data?.[0]
  if (!first?.b64_json) throw new Error(`OpenRouter returned no image (model: ${input.model})`)

  const buffer = Buffer.from(first.b64_json, "base64")
  if (buffer.length < MIN_REAL_IMAGE_BYTES) {
    throw new Error(
      `OpenRouter returned a suspiciously small image (${buffer.length} bytes < ${MIN_REAL_IMAGE_BYTES}, model: ${input.model})`,
    )
  }

  return { buffer, mime: first.media_type ?? "image/png", seed: 0 }
}
