import { fal } from "@fal-ai/client"

let configured = false

// Empirically, a real fal-generated image at our smallest size (1024×576 WebP
// or PNG) is well over 10KB. The all-black placeholder fal returns when the
// safety checker fires is ~1KB. 5KB is a comfortable middle that catches
// safety-tripped placeholders without false-flagging genuine low-detail
// images.
const MIN_REAL_IMAGE_BYTES = 5_000

export interface GenerateFalImageInput {
  model: string
  prompt: string
  width: number
  height: number
}

export interface GenerateFalImageResult {
  buffer: Buffer
  mime: string
}

interface FalImageResult {
  url: string
  content_type?: string
}

interface FalResponseData {
  images?: FalImageResult[]
  has_nsfw_concepts?: boolean[]
}

export async function generateFalImage(input: GenerateFalImageInput): Promise<GenerateFalImageResult> {
  const apiKey = process.env.FAL_KEY
  if (!apiKey) throw new Error("FAL_KEY is not set")
  if (!configured) {
    fal.config({ credentials: apiKey })
    configured = true
  }

  const response = await fal.subscribe(input.model, {
    input: {
      prompt: input.prompt,
      image_size: { width: input.width, height: input.height },
      num_images: 1,
      enable_safety_checker: true,
    },
    logs: false,
  })

  const data = response.data as FalResponseData
  const first = data.images?.[0]
  if (!first?.url) {
    throw new Error("Fal returned no images for prompt")
  }

  // Safety-checker guard. When fal's NSFW classifier fires, the response
  // includes has_nsfw_concepts[0] === true and serves a black placeholder
  // at the URL. Treat that as a generation failure so the caller (which
  // already catches per-inline-image errors) can skip silently instead of
  // uploading the black image.
  if (data.has_nsfw_concepts?.[0] === true) {
    throw new Error("Fal safety checker rejected the prompt — black placeholder returned")
  }

  const fetched = await fetch(first.url)
  if (!fetched.ok) {
    throw new Error(`Fal image download failed: HTTP ${fetched.status}`)
  }
  const arrayBuf = await fetched.arrayBuffer()
  const buffer = Buffer.from(arrayBuf)
  const mime = first.content_type ?? fetched.headers.get("content-type") ?? "image/png"

  // Defensive size check — covers the edge case where fal's response shape
  // changes or the safety flag is missing but the placeholder is still served.
  if (buffer.length < MIN_REAL_IMAGE_BYTES) {
    throw new Error(
      `Fal returned a suspiciously small image (${buffer.length} bytes < ${MIN_REAL_IMAGE_BYTES}); likely a safety-checker placeholder`,
    )
  }

  return { buffer, mime }
}
