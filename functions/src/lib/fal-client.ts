import { fal } from "@fal-ai/client"

let configured = false

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

  const data = response.data as { images?: Array<{ url: string; content_type?: string }> }
  const first = data.images?.[0]
  if (!first?.url) {
    throw new Error("Fal returned no images for prompt")
  }

  const fetched = await fetch(first.url)
  if (!fetched.ok) {
    throw new Error(`Fal image download failed: HTTP ${fetched.status}`)
  }
  const arrayBuf = await fetched.arrayBuffer()
  const buffer = Buffer.from(arrayBuf)
  const mime = first.content_type ?? fetched.headers.get("content-type") ?? "image/png"

  return { buffer, mime }
}
