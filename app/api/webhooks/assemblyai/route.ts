// app/api/webhooks/assemblyai/route.ts
// AssemblyAI POSTs here when a transcript completes (success or error).
//
// Failure modes handled:
//   1. status=error — the audio had no audio track / was corrupted / unsupported.
//      We fetch AssemblyAI's own error message for the UI and flip BOTH ai_job
//      AND video_uploads to "failed" so the row doesn't stay stuck on Transcribing.
//   2. status=completed but transcript.text is empty/near-empty — the audio was
//      present but contained no speech (silent footage, music only). Treated as
//      a soft failure: same failed state, message tells the admin why. No
//      transcript row is written so "Generate Social" can't run on garbage.

import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { createServiceRoleClient } from "@/lib/supabase"
import { createAiJob } from "@/lib/ai-jobs"

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2"

/**
 * AssemblyAI occasionally returns a completed transcript with whitespace-only
 * or very short text when the audio had no real speech. Anything shorter than
 * this threshold is treated as "no speech detected" and surfaced as a clean
 * failed state rather than letting downstream captioning run on empty input.
 */
const MIN_USEFUL_TRANSCRIPT_LENGTH = 30

async function fetchTranscriptErrorMessage(
  transcriptId: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}`, {
      headers: { authorization: apiKey },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { error?: string }
    return body.error ?? null
  } catch {
    return null
  }
}

async function markFailed(opts: {
  aiJobId: string
  videoUploadId: string | null
  errorMessage: string
}) {
  const firestore = getAdminFirestore()
  await firestore.collection("ai_jobs").doc(opts.aiJobId).update({
    status: "failed",
    error: opts.errorMessage,
    updatedAt: new Date(),
  })
  if (opts.videoUploadId) {
    const supabase = createServiceRoleClient()
    await supabase.from("video_uploads").update({ status: "failed" }).eq("id", opts.videoUploadId)
  }
}

/**
 * AssemblyAI failed on this video — attempt the vision fallback.
 * Queues a new ai_jobs doc of type "video_vision"; the videoVision Function
 * extracts frames and asks Claude Vision to describe what's happening.
 * The original ai_jobs doc is marked "completed" with a fallbackJobId ref so
 * it doesn't stay stuck as processing — the videoVision doc is what the UI
 * now watches via useAiJob.
 */
async function queueVisionFallback(opts: {
  originalJobId: string
  videoUploadId: string
  reason: string
  userId: string
}): Promise<void> {
  const firestore = getAdminFirestore()
  const { jobId: visionJobId } = await createAiJob({
    type: "video_vision",
    userId: opts.userId,
    input: { videoUploadId: opts.videoUploadId, fallbackReason: opts.reason },
  })
  await firestore.collection("ai_jobs").doc(opts.originalJobId).update({
    status: "completed",
    result: { fallbackJobId: visionJobId, reason: opts.reason },
    updatedAt: new Date(),
  })
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const aiJobId = searchParams.get("ai_job_id")
  if (!aiJobId) {
    return NextResponse.json({ error: "Missing ai_job_id" }, { status: 400 })
  }

  const payload = (await request.json().catch(() => null)) as
    | { transcript_id?: string; status?: string }
    | null
  const transcriptId = payload?.transcript_id
  const status = payload?.status

  if (!transcriptId || !status) {
    return NextResponse.json({ error: "Missing transcript_id or status" }, { status: 400 })
  }

  const firestore = getAdminFirestore()
  const jobRef = firestore.collection("ai_jobs").doc(aiJobId)
  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) {
    return NextResponse.json({ error: "Unknown ai_job" }, { status: 404 })
  }
  const job = jobSnap.data()!

  if (job.assemblyaiTranscriptId && job.assemblyaiTranscriptId !== transcriptId) {
    return NextResponse.json({ error: "Transcript id mismatch" }, { status: 409 })
  }

  const videoUploadId = (job.input as { videoUploadId?: string })?.videoUploadId ?? null
  const userId = (job.input as { userId?: string })?.userId ?? (job.userId as string | undefined) ?? null
  const apiKey = process.env.ASSEMBLYAI_API_KEY

  // ── Failure path — try Claude Vision fallback before marking failed ─────
  if (status === "error") {
    let reason = "AssemblyAI reported error status"
    if (apiKey) {
      const upstream = await fetchTranscriptErrorMessage(transcriptId, apiKey)
      if (upstream) reason = upstream
    }
    if (videoUploadId && userId) {
      await queueVisionFallback({ originalJobId: aiJobId, videoUploadId, reason, userId })
    } else {
      await markFailed({ aiJobId, videoUploadId, errorMessage: reason })
    }
    return NextResponse.json({ ok: true })
  }

  if (status !== "completed") {
    // Intermediate states (queued, processing) — ignore, AssemblyAI will
    // re-fire the webhook when it reaches a terminal status.
    return NextResponse.json({ ok: true })
  }

  // ── Success path ────────────────────────────────────────────────────────
  if (!apiKey) {
    return NextResponse.json({ error: "ASSEMBLYAI_API_KEY not configured" }, { status: 500 })
  }

  const response = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}`, {
    headers: { authorization: apiKey },
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    await markFailed({
      aiJobId,
      videoUploadId,
      errorMessage: `AssemblyAI fetch failed: ${text}`,
    })
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 })
  }
  const transcript = (await response.json()) as {
    id: string
    text: string
    language_code?: string
    status: string
    error?: string
  }

  if (!videoUploadId) {
    await markFailed({
      aiJobId,
      videoUploadId: null,
      errorMessage: "ai_job missing videoUploadId",
    })
    return NextResponse.json({ error: "Missing videoUploadId" }, { status: 400 })
  }

  // Empty-speech guard — AssemblyAI completes with empty text when the audio
  // has no speech (silent footage, music only, etc). Fall back to Claude
  // Vision analysis of sampled frames rather than giving up.
  const cleanText = (transcript.text ?? "").trim()
  if (cleanText.length < MIN_USEFUL_TRANSCRIPT_LENGTH) {
    if (userId) {
      await queueVisionFallback({
        originalJobId: aiJobId,
        videoUploadId,
        reason: "No speech detected — falling back to vision analysis.",
        userId,
      })
    } else {
      await markFailed({
        aiJobId,
        videoUploadId,
        errorMessage: "No speech detected — check that the video has a spoken audio track.",
      })
    }
    return NextResponse.json({ ok: true })
  }

  const supabase = createServiceRoleClient()
  await supabase.from("video_transcripts").insert({
    video_upload_id: videoUploadId,
    transcript_text: transcript.text,
    language: transcript.language_code ?? "en",
    assemblyai_job_id: transcript.id,
    analysis: null,
  })
  await supabase.from("video_uploads").update({ status: "transcribed" }).eq("id", videoUploadId)

  await jobRef.update({
    status: "completed",
    result: { videoUploadId, transcriptId: transcript.id },
    updatedAt: new Date(),
  })

  return NextResponse.json({ ok: true })
}
