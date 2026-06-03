// lib/split-reel/fal-submit.ts
// App-side single-clip submit to fal's QUEUE for per-window regeneration (Phase 3).
// Mirrors functions/src/lib/fal-broll.ts (submitBrollClip) — the functions runtime
// does the initial batch; the app does individual regenerates from the panel.
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
      // Kling/Seedance/most fal video models take `duration` as a STRING enum
      // ("5"/"10"), not a number; aspect_ratio "9:16" is shared. Keep this in
      // lockstep with functions/src/lib/fal-broll.ts (submitBrollClip).
      duration: String(opts.durationSeconds),
      aspect_ratio: "9:16",
      negative_prompt: "blur, distortion, low quality, text, captions, subtitles, watermark, logo, deformed",
    },
    webhookUrl: opts.webhookUrl,
  })
  return { requestId: request_id }
}

// Build the fal completion callback for one segment. Same shape the
// broll_generation function uses, so the existing /api/webhooks/fal-broll route
// handles regenerated clips identically.
export function brollWebhookUrl(segmentId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL/APP_URL not set for webhook callback")
  const secret = process.env.BROLL_WEBHOOK_SECRET
  if (!secret) throw new Error("BROLL_WEBHOOK_SECRET not set")
  return `${base.replace(/\/$/, "")}/api/webhooks/fal-broll?segment_id=${segmentId}&token=${secret}`
}
