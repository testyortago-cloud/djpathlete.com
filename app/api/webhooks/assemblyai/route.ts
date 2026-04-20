// app/api/webhooks/assemblyai/route.ts
// AssemblyAI POSTs here when a transcript is completed.

import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { createServiceRoleClient } from "@/lib/supabase"

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2"

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

  if (status === "error") {
    await jobRef.update({
      status: "failed",
      error: "AssemblyAI reported error status",
      updatedAt: new Date(),
    })
    return NextResponse.json({ ok: true })
  }

  if (status !== "completed") {
    return NextResponse.json({ ok: true })
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "ASSEMBLYAI_API_KEY not configured" }, { status: 500 })
  }

  const response = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}`, {
    headers: { authorization: apiKey },
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    await jobRef.update({
      status: "failed",
      error: `AssemblyAI fetch failed: ${text}`,
      updatedAt: new Date(),
    })
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 })
  }
  const transcript = (await response.json()) as {
    id: string
    text: string
    language_code?: string
    status: string
  }

  const videoUploadId = (job.input as { videoUploadId?: string })?.videoUploadId
  if (!videoUploadId) {
    await jobRef.update({
      status: "failed",
      error: "ai_job missing videoUploadId",
      updatedAt: new Date(),
    })
    return NextResponse.json({ error: "Missing videoUploadId" }, { status: 400 })
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
