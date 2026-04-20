// app/api/admin/blog-posts/generate-from-video/route.ts
// POST { video_upload_id, tone?, length? } — creates a placeholder blog draft +
// fires a blog_from_video ai_job. The Firebase Function fills in the draft.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createDraftForVideo } from "@/lib/db/blog-posts"

const ALLOWED_TONES = ["professional", "conversational", "motivational"] as const
const ALLOWED_LENGTHS = ["short", "medium", "long"] as const
type Tone = (typeof ALLOWED_TONES)[number]
type Length = (typeof ALLOWED_LENGTHS)[number]

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    video_upload_id?: string
    tone?: string
    length?: string
  } | null
  const videoUploadId = body?.video_upload_id
  if (!videoUploadId) {
    return NextResponse.json({ error: "video_upload_id is required" }, { status: 400 })
  }
  const tone: Tone = (ALLOWED_TONES as readonly string[]).includes(body?.tone ?? "")
    ? (body!.tone as Tone)
    : "professional"
  const length: Length = (ALLOWED_LENGTHS as readonly string[]).includes(body?.length ?? "")
    ? (body!.length as Length)
    : "medium"

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

  const draft = await createDraftForVideo({
    authorId: session.user.id,
    videoUploadId,
  })

  const { jobId, status } = await createAiJob({
    type: "blog_from_video",
    userId: session.user.id,
    input: {
      video_upload_id: videoUploadId,
      blog_post_id: draft.id,
      tone,
      length,
    },
  })

  return NextResponse.json({ jobId, status, blog_post_id: draft.id }, { status: 202 })
}
