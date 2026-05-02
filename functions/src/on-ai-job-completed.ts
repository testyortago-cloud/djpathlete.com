import { FieldValue, getFirestore } from "firebase-admin/firestore"
import type { Change, FirestoreEvent, QueryDocumentSnapshot } from "firebase-functions/v2/firestore"

interface JobShape {
  type?: string
  status?: string
  result?: { blog_post_id?: string } & Record<string, unknown>
  userId?: string
}

type AiJobUpdateEvent = FirestoreEvent<
  Change<QueryDocumentSnapshot> | undefined,
  { jobId: string }
>

/**
 * Fans out follow-up jobs after specific ai_jobs reach a terminal state.
 *
 * Phase 1 only handles: blog_generation completed -> enqueue blog_image_generation.
 */
export async function handleAiJobCompleted(event: AiJobUpdateEvent): Promise<void> {
  const before = event.data?.before.data() as JobShape | undefined
  const after = event.data?.after.data() as JobShape | undefined
  if (!after) return

  // Only act on the transition into 'completed', not subsequent writes.
  if (before?.status === "completed") return
  if (after.status !== "completed") return

  if (after.type !== "blog_generation") return

  const blogPostId = after.result?.blog_post_id
  if (!blogPostId) {
    console.warn(`[on-ai-job-completed] blog_generation ${event.params.jobId} completed without blog_post_id`)
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
    parentJobId: event.params.jobId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  console.log(
    `[on-ai-job-completed] Enqueued blog_image_generation ${newJobRef.id} for blog_post ${blogPostId}`,
  )
}
