// app/api/admin/content-studio/split-reel/render/route.ts
// Phase 3 manual render gate. After the operator reviews/approves the b-roll
// windows, this enqueues split_reel_render — but only once every window is
// resolved (none still pending/generating). Dedupes against an in-flight render.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { splitReelRenderSchema } from "@/lib/validators/split-reel"
import { getBrollSegmentsForVideo } from "@/lib/db/broll-segments"
import { canRenderSplitReel } from "@/lib/split-reel/render-gate"
import { createAiJob, findInFlightSplitRender } from "@/lib/ai-jobs"
import { withAudit } from "@/lib/audit/with-audit"

async function postHandler(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const enabled = await getSetting<boolean>("feature_split_reel_enabled", false)
  if (!enabled) return NextResponse.json({ error: "feature disabled" }, { status: 403 })

  const parsed = splitReelRenderSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 })
  const { videoUploadId } = parsed.data

  const segments = await getBrollSegmentsForVideo(videoUploadId)
  if (!canRenderSplitReel(segments)) {
    return NextResponse.json({ error: "b-roll windows are still generating" }, { status: 409 })
  }

  const existing = await findInFlightSplitRender(videoUploadId)
  if (existing) return NextResponse.json({ jobId: existing }, { status: 200 })

  const { jobId } = await createAiJob({ type: "split_reel_render", userId: session.user.id, input: { videoUploadId } })
  return NextResponse.json({ jobId }, { status: 202 })
}

export const POST = withAudit({ action: "split_reel.render", category: "admin_write" }, postHandler)
