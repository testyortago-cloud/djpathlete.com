import { FieldValue, getFirestore } from "firebase-admin/firestore"
import type { Change, FirestoreEvent, QueryDocumentSnapshot } from "firebase-functions/v2/firestore"

interface JobShape {
  type?: string
  status?: string
  result?: {
    blog_post_id?: string
    videoUploadId?: string
    fallbackJobId?: string
  } & Record<string, unknown>
  userId?: string
}

type AiJobUpdateEvent = FirestoreEvent<
  Change<QueryDocumentSnapshot> | undefined,
  { jobId: string }
>

/**
 * Fans out follow-up jobs after specific ai_jobs reach a terminal state.
 *
 * Chains:
 *   - blog_generation       → blog_image_generation
 *   - video_transcription   → social_fanout
 *   - video_vision          → social_fanout
 *
 * Both video paths set result.videoUploadId on success. The transcription job
 * also marks itself "completed" (with result.fallbackJobId, NO videoUploadId)
 * when AssemblyAI fails or returns empty speech and a vision fallback is
 * queued instead — that branch is correctly skipped because we require
 * videoUploadId on the result before chaining.
 */
export async function handleAiJobCompleted(event: AiJobUpdateEvent): Promise<void> {
  const before = event.data?.before.data() as JobShape | undefined
  const after = event.data?.after.data() as JobShape | undefined
  if (!after) return

  // Only act on the transition into 'completed', not subsequent writes.
  if (before?.status === "completed") return
  if (after.status !== "completed") return

  if (after.type === "blog_generation") {
    await chainBlogImageGeneration(event.params.jobId, after)
    return
  }

  if (after.type === "video_transcription" || after.type === "video_vision") {
    await chainSocialFanout(event.params.jobId, after)
    return
  }
}

async function chainBlogImageGeneration(parentJobId: string, after: JobShape): Promise<void> {
  const blogPostId = after.result?.blog_post_id
  if (!blogPostId) {
    console.warn(`[on-ai-job-completed] blog_generation ${parentJobId} completed without blog_post_id`)
    return
  }

  const db = getFirestore()
  const newJobRef = db.collection("ai_jobs").doc()
  await newJobRef.set({
    type: "blog_image_generation",
    status: "pending",
    input: { blog_post_id: blogPostId },
    result: null,
    error: null,
    userId: after.userId ?? null,
    parentJobId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  console.log(
    `[on-ai-job-completed] Enqueued blog_image_generation ${newJobRef.id} for blog_post ${blogPostId}`,
  )
}

async function chainSocialFanout(parentJobId: string, after: JobShape): Promise<void> {
  const videoUploadId = after.result?.videoUploadId
  if (!videoUploadId) {
    // Vision-fallback handoff branch — the original transcription job sets
    // result.fallbackJobId (no videoUploadId) and the vision job will fire
    // its own completion later. Skip silently to avoid the double-chain.
    return
  }

  const db = getFirestore()
  const newJobRef = db.collection("ai_jobs").doc()
  await newJobRef.set({
    type: "social_fanout",
    status: "pending",
    input: { videoUploadId },
    result: null,
    error: null,
    userId: after.userId ?? null,
    parentJobId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  console.log(
    `[on-ai-job-completed] Enqueued social_fanout ${newJobRef.id} for video ${videoUploadId}`,
  )
}
