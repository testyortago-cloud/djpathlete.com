// functions/src/lib/fal-broll.ts
// Submit a single text-to-video b-roll clip to fal's QUEUE (async) with a webhook.
// Unlike fal.subscribe (used for fast images), queue.submit returns immediately so
// the function isn't held open for the multi-minute video generation.
import { fal } from "@fal-ai/client"

let configured = false
function ensureConfigured() {
  if (configured) return
  const apiKey = process.env.FAL_KEY
  if (!apiKey) throw new Error("FAL_KEY not set")
  fal.config({ credentials: apiKey })
  configured = true
}

export async function submitBrollClip(opts: {
  model: string
  prompt: string
  durationSeconds: number
  webhookUrl: string
}): Promise<{ requestId: string }> {
  ensureConfigured()
  const { request_id } = await fal.queue.submit(opts.model, {
    input: {
      prompt: opts.prompt,
      // Most fal text-to-video endpoints accept these; extras are ignored by the model.
      duration: opts.durationSeconds,
      aspect_ratio: "9:16",
    },
    webhookUrl: opts.webhookUrl,
  })
  return { requestId: request_id }
}

export async function fetchBrollResult(model: string, requestId: string): Promise<{ videoUrl: string | null }> {
  ensureConfigured()
  const res = (await fal.queue.result(model, { requestId })) as { data?: { video?: { url?: string } } }
  return { videoUrl: res?.data?.video?.url ?? null }
}
