import { FieldValue, getFirestore } from "firebase-admin/firestore"
import type { Change, FirestoreEvent, QueryDocumentSnapshot } from "firebase-functions/v2/firestore"
import {
  buildWeekContinuationInput,
  nextContinuationWeek,
  type ContinuationMeta,
  type WeekContinuationSeed,
} from "./ai/generation-continuation.js"

interface JobShape {
  type?: string
  status?: string
  input?: {
    videoUploadId?: string
    request?: Record<string, unknown>
    requestedBy?: string
    notify_email?: string | null
    continuation?: ContinuationMeta
  } & Record<string, unknown>
  result?: {
    blog_post_id?: string
    videoUploadId?: string
    fallbackJobId?: string
    new_week_number?: number
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
 *   - week_generation       → week_generation (program-generation continuation only)
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

  if (after.type === "week_generation") {
    await chainNextProgramWeek(event.params.jobId, after)
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

// Phase 3: the reel ALWAYS auto-renders once b-roll generation completes — the
// one-click "Create Reel" flow has no separate render step. The videoUploadId
// lives on the broll_generation job's INPUT (its result only carries counts).
async function chainSplitReelRender(parentJobId: string, after: JobShape): Promise<void> {
  const videoUploadId = after.input?.videoUploadId
  if (!videoUploadId) {
    console.warn(`[on-ai-job-completed] broll_generation ${parentJobId} completed without input.videoUploadId`)
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

/**
 * Advances a program-generation continuation by one week.
 *
 * A full program cannot be generated in one invocation past ~3 weeks (540s
 * Eventarc ceiling, weeks must run in order for dedup), so the orchestrator
 * commits what it finished and queues the next week as its own job. Each link
 * queues the one after it here.
 *
 * Only jobs carrying `input.continuation` chain. A week the coach generated by
 * hand from the program screen has no continuation block and must stay exactly
 * one week — chaining that would silently regenerate the rest of their program.
 */
async function chainNextProgramWeek(parentJobId: string, after: JobShape): Promise<void> {
  const continuation = after.input?.continuation
  if (!continuation || continuation.origin !== "program_generation") return

  const completedWeek = after.result?.new_week_number
  const nextWeek = nextContinuationWeek(completedWeek, continuation)
  if (nextWeek === null) {
    console.log(
      `[on-ai-job-completed] Program continuation finished at week ${completedWeek ?? "unknown"}/${continuation.final_week} (job ${parentJobId})`,
    )
    return
  }

  const request = (after.input?.request ?? {}) as Record<string, unknown>
  const programId = typeof request.program_id === "string" ? request.program_id : null
  if (!programId) {
    console.warn(`[on-ai-job-completed] week_generation ${parentJobId} has a continuation but no program_id`)
    return
  }

  const seed: WeekContinuationSeed = {
    program_id: programId,
    client_id: (request.client_id as string | null) ?? null,
    admin_instructions: (request.admin_instructions as string | null) ?? null,
    pool_exercise_ids: (request.pool_exercise_ids as string[] | null) ?? null,
    pool_mode: (request.pool_mode as "preferred" | "strict" | undefined) ?? "preferred",
    ignore_profile: (request.ignore_profile as boolean | undefined) ?? false,
  }

  const input = buildWeekContinuationInput(seed, nextWeek, continuation, (after.input?.requestedBy as string) ?? "")

  const db = getFirestore()
  const newJobRef = db.collection("ai_jobs").doc()
  await newJobRef.set({
    type: "week_generation",
    status: "pending",
    input,
    result: null,
    error: null,
    userId: after.userId ?? null,
    parentJobId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  console.log(
    `[on-ai-job-completed] Enqueued week_generation ${newJobRef.id} for week ${nextWeek}/${continuation.final_week} of program ${programId}`,
  )
}
