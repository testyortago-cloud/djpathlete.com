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
  | "week_generation"
  | "blog_generation"
  | "newsletter_generation"
  | "newsletter_send"
  | "admin_chat"
  | "ai_coach"
  // Starter AI Automation (Phase 2+ — handlers not yet implemented)
  | "social_fanout"
  | "video_transcription"
  | "tavily_research"
  | "tavily_fact_check"
  | "tavily_trending_scan"
  | "blog_from_video"
  | "newsletter_from_blog"
  | "seo_enhance"
  | "enhance_caption"

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
