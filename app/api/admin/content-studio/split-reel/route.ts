// app/api/admin/content-studio/split-reel/route.ts
// Admin-only Split Reel route. GET returns current pipeline state (in-flight
// generation/render jobs + b-roll segments) so a panel can rehydrate. POST is
// gated by feature_split_reel_enabled, validates the payload, requires a speech
// transcript, dedupes against an in-flight generation, then queues a
// broll_generation ai_job (which auto-chains to split_reel_render on completion).
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { splitReelGenerateSchema } from "@/lib/validators/split-reel"
import { getSpeechTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createAiJob, findInFlightBrollGeneration, findInFlightSplitRender } from "@/lib/ai-jobs"
import { getBrollSegmentsForVideo } from "@/lib/db/broll-segments"
import { withAudit } from "@/lib/audit/with-audit"

async function getHandler(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const videoUploadId = new URL(request.url).searchParams.get("videoUploadId")
  if (!videoUploadId) return NextResponse.json({ error: "videoUploadId required" }, { status: 400 })

  const [genJob, renderJob, segments] = await Promise.all([
    findInFlightBrollGeneration(videoUploadId),
    findInFlightSplitRender(videoUploadId),
    getBrollSegmentsForVideo(videoUploadId),
  ])
  return NextResponse.json({
    inFlightBrollJobId: genJob,
    inFlightRenderJobId: renderJob,
    segments: segments.map((s) => ({
      id: s.id,
      index: s.segment_index,
      concept: s.concept,
      status: s.status,
      startMs: s.start_ms,
      endMs: s.end_ms,
    })),
  })
}

async function postHandler(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const enabled = await getSetting<boolean>("feature_split_reel_enabled", false)
  if (!enabled) return NextResponse.json({ error: "feature disabled" }, { status: 403 })

  const parsed = splitReelGenerateSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 })
  const { videoUploadId } = parsed.data

  const transcript = await getSpeechTranscriptForVideo(videoUploadId)
  if (!transcript) return NextResponse.json({ error: "no speech transcript" }, { status: 409 })

  const existing = await findInFlightBrollGeneration(videoUploadId)
  if (existing) return NextResponse.json({ jobId: existing }, { status: 200 })

  const { jobId } = await createAiJob({ type: "broll_generation", userId: session.user.id, input: { videoUploadId } })
  return NextResponse.json({ jobId }, { status: 202 })
}

// GET is a plain state read (not audited — reads of render state don't need an
// audit trail, and the single "split_reel.broll_generate" slug is admin_write).
export const GET = getHandler
export const POST = withAudit({ action: "split_reel.broll_generate", category: "admin_write" }, postHandler)
