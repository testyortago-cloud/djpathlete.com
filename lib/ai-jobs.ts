// lib/ai-jobs.ts
// Helper for queueing AI jobs via Firestore. Firebase Functions subscribe
// to `ai_jobs/{jobId}` document creation and dispatch based on `type`.
//
// Every AI-job-creating API route should use createAiJob() to keep the
// shape consistent. See app/api/admin/blog/generate/route.ts for an
// example of how this is called.

import { FieldValue } from "firebase-admin/firestore"
import { getAdminFirestore } from "@/lib/firebase-admin"

export type AiJobType =
  // Existing types (already handled by live Firebase Functions)
  | "program_generation"
  | "program_chat"
  | "program_from_excel"
  | "week_generation"
  | "blog_generation"
  | "newsletter_generation"
  | "newsletter_send"
  | "admin_chat"
  | "ai_coach"
  // Starter AI Automation (Phase 2+ — handlers not yet implemented)
  | "social_fanout"
  | "social_agent_run"
  | "video_transcription"
  | "video_vision"
  | "video_caption_render"
  | "image_vision"
  | "image_caption_generation"
  | "tavily_research"
  | "tavily_fact_check"
  | "tavily_trending_scan"
  | "topic_research_scan"
  | "blog_from_video"
  | "newsletter_from_blog"
  | "seo_enhance"
  | "enhance_caption"
  | "performance_critic_run"
  | "chief_strategist_run"
  | "social_outcome_tracker_run"
  | "broll_generation"
  | "split_reel_render"
  | "statement_import"
  | "receipt_scan"

export interface CreateAiJobOptions {
  type: AiJobType
  userId: string
  input: Record<string, unknown>
}

export interface CreateAiJobResult {
  jobId: string
  status: "pending"
}

/**
 * Creates a new ai_jobs Firestore document. The matching Firebase Function
 * (subscribed to onDocumentCreated for ai_jobs/{jobId}) will fire and process
 * the job asynchronously.
 *
 * @returns the Firestore-generated job id so callers can return it to the
 *   client for polling / live-listening via useAiJob(jobId).
 */
export async function createAiJob(options: CreateAiJobOptions): Promise<CreateAiJobResult> {
  const { type, userId, input } = options

  if (!userId) {
    throw new Error("createAiJob: userId is required")
  }

  const db = getAdminFirestore()
  const jobRef = db.collection("ai_jobs").doc()

  await jobRef.set({
    type,
    status: "pending",
    input: { ...input, userId },
    result: null,
    error: null,
    userId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { jobId: jobRef.id, status: "pending" }
}

/**
 * Returns the id of an existing captioned-cut render job for this video that is
 * still pending/processing, or null. Used by the create-route to avoid
 * double-queuing on a rapid second click. Requires a Firestore composite index
 * on (type ASC, input.videoUploadId ASC, status ASC) — Firestore prints a
 * one-click "create index" link the first time this query runs.
 */
export async function findInFlightCaptionRender(videoUploadId: string): Promise<string | null> {
  const db = getAdminFirestore()
  const snap = await db
    .collection("ai_jobs")
    .where("type", "==", "video_caption_render")
    .where("input.videoUploadId", "==", videoUploadId)
    .where("status", "in", ["pending", "processing"])
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0].id
}

export async function findInFlightBrollGeneration(videoUploadId: string): Promise<string | null> {
  const db = getAdminFirestore()
  const snap = await db
    .collection("ai_jobs")
    .where("type", "==", "broll_generation")
    .where("input.videoUploadId", "==", videoUploadId)
    .where("status", "in", ["pending", "processing"])
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0].id
}

export async function findInFlightSplitRender(videoUploadId: string): Promise<string | null> {
  const db = getAdminFirestore()
  const snap = await db
    .collection("ai_jobs")
    .where("type", "==", "split_reel_render")
    .where("input.videoUploadId", "==", videoUploadId)
    .where("status", "in", ["pending", "processing"])
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0].id
}

/**
 * In-flight duplicate guards for blog generation. A rapid double-click on a
 * generate button enqueued two identical jobs 3 seconds apart in prod — two
 * full paid generations and twin draft posts. Keyed by input.promptHash
 * (sha256 of the full request payload — Firestore can't index values >1500
 * bytes, so the raw prompt can't be the key). Same composite-index note as
 * findInFlightCaptionRender.
 *
 * Limitations (accepted for a single-admin app): the check-then-create is
 * not transactional, so two requests inside the ~100-300ms window can still
 * both enqueue — this narrows the double-submit window, it doesn't seal it.
 * A doc wedged in "processing" (function hard-killed, catch never ran) must
 * not absorb submissions forever, so matches older than STALE_JOB_CUTOFF_MS
 * are ignored.
 */
const STALE_JOB_CUTOFF_MS = 20 * 60_000 // blog generation completes in ~1-2 min

function freshJobIdOrNull(
  snap: FirebaseFirestore.QuerySnapshot,
): string | null {
  if (snap.empty) return null
  const doc = snap.docs[0]
  const createdAt = (doc.get("createdAt") as { toMillis?: () => number } | null)?.toMillis?.()
  if (createdAt != null && Date.now() - createdAt > STALE_JOB_CUTOFF_MS) return null
  return doc.id
}

export async function findInFlightBlogGeneration(promptHash: string): Promise<string | null> {
  const db = getAdminFirestore()
  const snap = await db
    .collection("ai_jobs")
    .where("type", "==", "blog_generation")
    .where("input.promptHash", "==", promptHash)
    .where("status", "in", ["pending", "processing"])
    .limit(1)
    .get()
  return freshJobIdOrNull(snap)
}

/** Same guard for topic-suggestion drafts, keyed by the calendar entry. */
export async function findInFlightBlogSuggestionJob(calendarId: string): Promise<string | null> {
  const db = getAdminFirestore()
  const snap = await db
    .collection("ai_jobs")
    .where("type", "==", "blog_generation")
    .where("input.sourceCalendarId", "==", calendarId)
    .where("status", "in", ["pending", "processing"])
    .limit(1)
    .get()
  return freshJobIdOrNull(snap)
}

/**
 * In-flight guard for week/day generation.
 *
 * The dialogs already hide the form while `isGenerating`, but that lives in
 * component state — closing the dialog or reloading the page resets it and the
 * form comes back, so a second job can be queued over a running one. This is the
 * authoritative check: it runs on the server, survives reloads, and is shared by
 * every caller.
 *
 * Scope is program + target week + target day, because generating week 5 while
 * week 4 runs is legitimate. An "append a new week" request has a null
 * target_week_number, and two of those DO collide — which is correct, they would
 * both append to the same program.
 *
 * Staleness: matches older than the cutoff are ignored so a wedged doc can never
 * block generation forever. Mirrors DEFAULT_STALE_MS in
 * functions/src/lib/stale-ai-jobs.ts (the reaper that fails such docs) — these
 * are twin copies because functions/ has rootDir "src" and cannot import lib/.
 */
const WEEK_GENERATION_STALE_MS = 45 * 60_000

export interface InFlightWeekGeneration {
  jobId: string
  status: AiJobStatus
  /** ISO start time so the UI can anchor an elapsed timer. */
  startedAt: string | null
}

export async function findInFlightWeekGeneration(
  programId: string,
  targetWeekNumber: number | null,
  targetDayOfWeek: number | null,
): Promise<InFlightWeekGeneration | null> {
  const db = getAdminFirestore()

  // Queried by (type, createdAt) — the SAME composite index listRecentCaptionRenders
  // already requires, so this needs no new index. Status / program / week / day are
  // filtered in JS: the in-flight set is tiny, and a nested-field index would have to
  // be created in prod before the first call could succeed.
  const snap = await db
    .collection("ai_jobs")
    .where("type", "==", "week_generation")
    .orderBy("createdAt", "desc")
    .limit(30)
    .get()

  for (const doc of snap.docs) {
    const data = doc.data()
    if (data.status !== "pending" && data.status !== "processing") continue

    const req = data.input?.request
    if (!req || req.program_id !== programId) continue
    if ((req.target_week_number ?? null) !== targetWeekNumber) continue
    if ((req.target_day_of_week ?? null) !== targetDayOfWeek) continue

    // A doc whose serverTimestamp has not materialized yet reads as null. Treat it
    // as fresh — it was written moments ago, which is exactly a double-submit.
    const createdAtMs = (data.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? null
    if (createdAtMs != null && Date.now() - createdAtMs > WEEK_GENERATION_STALE_MS) continue

    return {
      jobId: doc.id,
      status: data.status as AiJobStatus,
      startedAt: createdAtMs != null ? new Date(createdAtMs).toISOString() : null,
    }
  }

  return null
}

export type AiJobStatus = "pending" | "processing" | "streaming" | "completed" | "failed" | "cancelled"

export interface RecentCaptionRender {
  jobId: string
  videoUploadId: string
  status: AiJobStatus
  /** Job creation time as ISO (from the createdAt serverTimestamp), so the
   *  "rendering" elapsed timer can anchor to a stable start instead of mount.
   *  Null if the serverTimestamp hasn't materialized yet. */
  startedAt: string | null
}

/**
 * Recent captioned-cut render jobs (newest first), for deriving the Videos-lane
 * edit columns. Ordered by createdAt desc so the first row seen per videoUploadId
 * is its latest render. Requires a Firestore composite index on
 * (type ASC, createdAt DESC) — Firestore prints a one-click "create index" link
 * the first time this runs.
 */
export async function listRecentCaptionRenders(limit = 300): Promise<RecentCaptionRender[]> {
  const db = getAdminFirestore()
  const snap = await db
    .collection("ai_jobs")
    .where("type", "==", "video_caption_render")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get()
  const out: RecentCaptionRender[] = []
  for (const doc of snap.docs) {
    const data = doc.data()
    const videoUploadId = data?.input?.videoUploadId
    if (typeof videoUploadId !== "string") continue
    const createdAt = data?.createdAt
    const startedAt = createdAt && typeof createdAt.toDate === "function" ? createdAt.toDate().toISOString() : null
    out.push({ jobId: doc.id, videoUploadId, status: data.status as AiJobStatus, startedAt })
  }
  return out
}
