// app/api/admin/content-studio/captioned-cut/route.ts
// Create-job route for the Captioned Cut feature. Admin-only, gated by the
// DB-backed feature_captioned_cut_enabled flag. Validates the payload, resolves
// to a video_uploads id (Milestone 1: videoUploadId only — submissionId is
// handled in Milestone 2), enforces the speech-transcript guard, dedupes against
// an in-flight render, then queues a video_caption_render ai_job.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { captionedCutRequestSchema } from "@/lib/validators/captioned-cut"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getSpeechTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createAiJob, findInFlightCaptionRender } from "@/lib/ai-jobs"

export async function POST(request: NextRequest | Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const enabled = await getSetting<boolean>("feature_captioned_cut_enabled", false)
  if (!enabled) {
    return NextResponse.json({ error: "Captioned Cut is disabled." }, { status: 403 })
  }

  const parsed = captionedCutRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  // Milestone 1: drawer path only. submissionId is wired in Milestone 2.
  if (!parsed.data.videoUploadId) {
    return NextResponse.json(
      { error: "submissionId is not supported yet — open the video in Content Studio." },
      { status: 400 },
    )
  }
  const videoUploadId = parsed.data.videoUploadId

  const video = await getVideoUploadById(videoUploadId)
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 })
  }

  // Transcript guard: needs a speech transcript with word timings.
  const transcript = await getSpeechTranscriptForVideo(videoUploadId)
  if (!transcript) {
    return NextResponse.json(
      { error: "No speech transcript yet — captions need a spoken-audio transcript first." },
      { status: 422 },
    )
  }

  // In-flight guard: surface the running job instead of double-queuing.
  const inFlight = await findInFlightCaptionRender(videoUploadId)
  if (inFlight) {
    return NextResponse.json({ jobId: inFlight }, { status: 200 })
  }

  const { jobId } = await createAiJob({
    type: "video_caption_render",
    userId: session.user.id,
    input: { videoUploadId },
  })
  return NextResponse.json({ jobId }, { status: 202 })
}
