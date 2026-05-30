// lib/content-studio/promote-submission.ts
// Idempotent: resolve a team submission to a single Content Studio video_uploads
// row. Reuses the existing row (keyed on source_submission_id) or creates it,
// locks the submission, and queues transcription — mirroring the existing
// send-to-content-studio behavior so there is one promotion code path.

import { getVideoUploadBySubmission, createVideoUpload } from "@/lib/db/video-uploads"
import { getSubmissionById, lockSubmission } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { getSpeechTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createAiJob } from "@/lib/ai-jobs"

export interface ResolvedSubmissionVideo {
  videoUploadId: string
  /** True if a speech transcript with word timings already exists. */
  transcribed: boolean
}

export async function resolveVideoUploadForSubmission(
  submissionId: string,
  adminId: string,
): Promise<ResolvedSubmissionVideo> {
  const existing = await getVideoUploadBySubmission(submissionId)
  if (existing) {
    const tx = await getSpeechTranscriptForVideo(existing.id)
    return { videoUploadId: existing.id, transcribed: Boolean(tx) }
  }

  const submission = await getSubmissionById(submissionId)
  if (!submission) throw new Error("Submission not found")
  if (submission.status !== "approved" && submission.status !== "locked") {
    throw new Error("Only approved submissions can be sent to Content Studio")
  }

  const version = await getCurrentVersion(submissionId)
  if (!version?.storage_path || !version.original_filename) {
    throw new Error("Submission has no uploaded video version")
  }

  const row = await createVideoUpload({
    storage_path: version.storage_path,
    original_filename: version.original_filename,
    duration_seconds: version.duration_seconds,
    size_bytes: version.size_bytes,
    mime_type: version.mime_type,
    title: submission.title,
    uploaded_by: adminId,
    status: "uploaded",
    source_submission_id: submissionId,
  })

  await lockSubmission(submissionId)

  // Auto-queue transcription. Non-fatal (matches the original send-to-content-studio
  // behavior): the video_uploads row already exists, so a queue failure just means
  // the admin re-triggers later or clicks Transcribe manually.
  try {
    await createAiJob({
      type: "video_transcription",
      userId: adminId,
      input: { videoUploadId: row.id },
    })
  } catch (err) {
    console.error(
      `[promote-submission] failed to queue transcription for video ${row.id}: ${(err as Error).message}`,
    )
  }

  return { videoUploadId: row.id, transcribed: false }
}
