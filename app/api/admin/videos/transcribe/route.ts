// app/api/admin/videos/transcribe/route.ts
// POST { videoUploadId } — triggers video transcription via a Firebase Function.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { getVideoUploadById } from "@/lib/db/video-uploads"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { videoUploadId?: string } | null
  const videoUploadId = body?.videoUploadId
  if (!videoUploadId) {
    return NextResponse.json({ error: "videoUploadId is required" }, { status: 400 })
  }

  const upload = await getVideoUploadById(videoUploadId)
  if (!upload) {
    return NextResponse.json({ error: "Video upload not found" }, { status: 404 })
  }

  const { jobId, status } = await createAiJob({
    type: "video_transcription",
    userId: session.user.id,
    input: { videoUploadId },
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
