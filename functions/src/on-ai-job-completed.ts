import { FieldValue, getFirestore } from "firebase-admin/firestore"
import type { Change, FirestoreEvent, QueryDocumentSnapshot } from "firebase-functions/v2/firestore"
import { getSupabase } from "./lib/supabase.js"

interface JobShape {
  type?: string
  status?: string
  input?: {
    videoUploadId?: string
  } & Record<string, unknown>
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

  if (after.type === "broll_generation") {
    await chainSplitReelRender(event.params.jobId, after)
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

// Phase 3: the auto-chain is GATED behind split_reel_auto_render (default false),
// so generation stops at operator review and the render fires from the explicit
// POST /split-reel/render. The videoUploadId lives on the broll_generation job's
// INPUT (its result only carries segmentCount).
async function chainSplitReelRender(parentJobId: string, after: JobShape): Promise<void> {
  const videoUploadId = after.input?.videoUploadId
  if (!videoUploadId) {
    console.warn(`[on-ai-job-completed] broll_generation ${parentJobId} completed without input.videoUploadId`)
    return
  }

  // Gate: only auto-render when split_reel_auto_render is true (Phase 2 behavior).
  const supabase = getSupabase()
  const { data: setting } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "split_reel_auto_render")
    .maybeSingle()
  if (setting?.value !== true) {
    console.log(
      `[on-ai-job-completed] split_reel_auto_render off — broll_generation ${parentJobId} awaits operator approval`,
    )
    return
  }

  const db = getFirestore()
  const newJobRef = db.collection("ai_jobs").doc()
  await newJobRef.set({
    type: "split_reel_render",
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
    `[on-ai-job-completed] Enqueued split_reel_render ${newJobRef.id} for video ${videoUploadId}`,
  )
}
