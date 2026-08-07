// app/api/admin/content-studio/split-reel/broll/regenerate/route.ts
// Phase 3: regenerate ONE b-roll window (optionally with an edited prompt). Re-submits
// a single clip to fal's queue with the same webhook the batch uses, and flips the
// segment back to 'generating' (recomputed cache_key, old clip cleared). The existing
// /api/webhooks/fal-broll route fills it back in when fal finishes.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { brollRegenerateSchema } from "@/lib/validators/split-reel"
import { getBrollSegmentById, regenerateBrollSegment } from "@/lib/db/broll-segments"
import { brollCacheKey } from "@/lib/split-reel/broll-selection"
import { submitBrollClip, brollWebhookUrl } from "@/lib/split-reel/fal-submit"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"

async function postHandler(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const enabled = await getSetting<boolean>("feature_split_reel_enabled", false)
  if (!enabled) return NextResponse.json({ error: "feature disabled" }, { status: 403 })

  const parsed = brollRegenerateSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 })
  const { segmentId, prompt: newPrompt } = parsed.data

  const segment = await getBrollSegmentById(segmentId)
  if (!segment) return NextResponse.json({ error: "unknown segment" }, { status: 404 })
  if (segment.status === "dropped") {
    return NextResponse.json({ error: "cannot regenerate a dropped window" }, { status: 409 })
  }

  const model = await getSetting<string>("split_reel_broll_model", "fal-ai/kling-video/v2.5-turbo/pro/text-to-video")
  const windowSeconds = await getSetting<number>("split_reel_broll_window_seconds", 5)
  const prompt = newPrompt?.trim() || segment.prompt
  const cacheKey = brollCacheKey(prompt, model, windowSeconds)

  const { requestId } = await submitBrollClip({
    model,
    prompt,
    durationSeconds: windowSeconds,
    webhookUrl: brollWebhookUrl(segment.id),
  })
  await regenerateBrollSegment(segment.id, { prompt, cache_key: cacheKey, fal_request_id: requestId })

  return NextResponse.json({ ok: true })
}

export const POST = withAudit({ action: "split_reel.regenerate", category: "admin_write" }, postHandler)
