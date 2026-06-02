// lib/split-reel/fal-result.ts
import { fal } from "@fal-ai/client"
import { getSetting } from "@/lib/db/system-settings"

let configured = false
function ensure() {
  if (configured) return
  const key = process.env.FAL_KEY
  if (!key) throw new Error("FAL_KEY not set")
  fal.config({ credentials: key })
  configured = true
}

export async function fetchBrollResultUrl(requestId: string, _videoUploadId: string): Promise<string | null> {
  ensure()
  const model = await getSetting<string>("split_reel_broll_model", "fal-ai/ltx-video")
  const res = (await fal.queue.result(model, { requestId })) as { data?: { video?: { url?: string } } }
  return res?.data?.video?.url ?? null
}
