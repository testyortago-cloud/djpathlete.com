import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSubmissionById, lockSubmission } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { createVideoUpload } from "@/lib/db/video-uploads"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  if (submission.status !== "approved") {
    return NextResponse.json(
      { error: "Only approved submissions can be sent to Content Studio" },
      { status: 409 },
    )
  }

  const version = await getCurrentVersion(submission.id)
  if (!version) return NextResponse.json({ error: "No current version" }, { status: 409 })

  // Create the Content Studio video_uploads row using the approved version's
  // storage path. Content Studio's existing pipeline (transcribe, post compose,
  // schedule) takes over from there.
  const videoUpload = await createVideoUpload({
    storage_path: version.storage_path,
    original_filename: version.original_filename,
    duration_seconds: version.duration_seconds,
    size_bytes: version.size_bytes,
    mime_type: version.mime_type,
    title: submission.title,
    uploaded_by: session.user.id,
    status: "uploaded",
  })

  await lockSubmission(submission.id)

  // Auto-kick the transcription pipeline so promoted team videos don't sit
  // in the Uploaded column waiting for a manual click. The on-ai-job-completed
  // Firebase handler then chains transcription → social_fanout, so the
  // promoted video lands in the studio with 6 draft captions ready to review.
  // A queue failure here is non-fatal: the studio still has the video row,
  // and the admin can click Transcribe manually as a fallback.
  try {
    await createAiJob({
      type: "video_transcription",
      userId: session.user.id,
      input: { videoUploadId: videoUpload.id },
    })
  } catch (err) {
    console.error(
      `[send-to-content-studio] Failed to auto-queue transcription for video ${videoUpload.id}: ${(err as Error).message}`,
    )
  }

  return NextResponse.json({ videoUpload }, { status: 201 })
}
