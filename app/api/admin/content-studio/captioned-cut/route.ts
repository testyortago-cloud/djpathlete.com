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
import { resolveVideoUploadForSubmission } from "@/lib/content-studio/promote-submission"
import { getLatestCaptionedCutForVideo } from "@/lib/db/media-assets"
import { getAdminStorage } from "@/lib/firebase-admin"

const CUT_URL_EXPIRY_MS = 6 * 60 * 60 * 1000 // 6h — long enough to watch the cut

// GET — current captioned-cut state for a video, so the drawer panel rehydrates
// on open (survives refresh / navigating away mid-render): any in-flight render
// job id + the latest rendered cut (signed for inline playback) + its draft posts.
export async function GET(request: NextRequest | Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const enabled = await getSetting<boolean>("feature_captioned_cut_enabled", false)
  if (!enabled) {
    return NextResponse.json({ error: "Captioned Cut is disabled." }, { status: 403 })
  }

  const videoUploadId = new URL(request.url).searchParams.get("videoUploadId")
  if (!videoUploadId) {
    return NextResponse.json({ error: "videoUploadId required" }, { status: 400 })
  }

  const [inFlightJobId, cut] = await Promise.all([
    findInFlightCaptionRender(videoUploadId),
    getLatestCaptionedCutForVideo(videoUploadId),
  ])

  let signedCut = null
  if (cut) {
    const [signedUrl] = await getAdminStorage()
      .bucket()
      .file(cut.asset.storage_path)
      .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + CUT_URL_EXPIRY_MS })
    signedCut = {
      assetId: cut.asset.id,
      signedUrl,
      width: cut.asset.width,
      height: cut.asset.height,
      durationMs: cut.asset.duration_ms,
      createdAt: cut.asset.created_at,
      posts: cut.posts.map((p) => ({ id: p.id, platform: p.platform, approvalStatus: p.approval_status })),
    }
  }

  return NextResponse.json({ inFlightJobId, cut: signedCut })
}

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

  let videoUploadId: string
  if (parsed.data.submissionId) {
    // Team path: promote-or-reuse to a single video_uploads row. A just-created
    // row has transcription queued but not finished — tell the admin to retry
    // rather than queue a render with no word timings.
    let resolved
    try {
      resolved = await resolveVideoUploadForSubmission(parsed.data.submissionId, session.user.id)
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 409 })
    }
    if (!resolved.transcribed) {
      return NextResponse.json(
        { error: "Promoted to Content Studio — still transcribing. Try again in a minute." },
        { status: 409 },
      )
    }
    videoUploadId = resolved.videoUploadId
  } else {
    videoUploadId = parsed.data.videoUploadId!
    const video = await getVideoUploadById(videoUploadId)
    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 })
    }
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

  const hook = parsed.data.hook && parsed.data.hook.length > 0 ? parsed.data.hook : undefined
  const music = parsed.data.music && parsed.data.music.length > 0 ? parsed.data.music : undefined
  const { jobId } = await createAiJob({
    type: "video_caption_render",
    userId: session.user.id,
    input: {
      videoUploadId,
      ...(hook ? { hook } : {}),
      ...(music ? { music } : {}),
    },
  })
  return NextResponse.json({ jobId }, { status: 202 })
}
