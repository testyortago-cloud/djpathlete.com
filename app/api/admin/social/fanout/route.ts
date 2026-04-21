// app/api/admin/social/fanout/route.ts
// POST { videoUploadId } — triggers social fanout via a Firebase Function.
// Pre-checks that the video exists and has a transcript before queueing.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getTranscriptForVideo } from "@/lib/db/video-transcripts"
import { listSocialPostsBySourceVideo } from "@/lib/db/social-posts"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as
    | { videoUploadId?: string; force?: boolean }
    | null
  const videoUploadId = body?.videoUploadId
  const force = body?.force === true
  if (!videoUploadId) {
    return NextResponse.json({ error: "videoUploadId is required" }, { status: 400 })
  }

  const upload = await getVideoUploadById(videoUploadId)
  if (!upload) {
    return NextResponse.json({ error: "Video upload not found" }, { status: 404 })
  }

  const transcript = await getTranscriptForVideo(videoUploadId)
  if (!transcript) {
    return NextResponse.json(
      { error: "Video has no transcript yet — run Transcribe first" },
      { status: 409 },
    )
  }

  if (!force) {
    const existing = await listSocialPostsBySourceVideo(videoUploadId)
    if (existing.length > 0) {
      return NextResponse.json(
        {
          error: "Social captions already exist for this video — pass { force: true } to regenerate",
          existingCount: existing.length,
        },
        { status: 409 },
      )
    }
  }

  const { jobId, status } = await createAiJob({
    type: "social_fanout",
    userId: session.user.id,
    input: { videoUploadId },
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
