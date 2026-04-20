// functions/src/transcribe-video.ts
// Firebase Function handler: submits a video from Firebase Storage to
// AssemblyAI for transcription. Called when an ai_jobs doc is created with
// type="video_transcription". video_uploads.storage_path is a Firebase
// Storage object path in the default bucket.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { getStorage } from "firebase-admin/storage"
import { getSupabase } from "./lib/supabase.js"
import { submitTranscription } from "./lib/assemblyai.js"

export async function handleVideoTranscription(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const supabase = getSupabase()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function failJob(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    const snap = await jobRef.get()
    const data = snap.data()
    if (!data) {
      await failJob("ai_jobs doc disappeared")
      return
    }
    const videoUploadId = (data.input as { videoUploadId?: string })?.videoUploadId
    if (!videoUploadId) {
      await failJob("input.videoUploadId is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const { data: upload, error } = await supabase
      .from("video_uploads")
      .select("id, storage_path")
      .eq("id", videoUploadId)
      .single()

    if (error || !upload) {
      await failJob(`video_uploads row ${videoUploadId} not found`)
      return
    }

    let signedUrl: string
    try {
      const bucket = getStorage().bucket()
      const file = bucket.file(upload.storage_path)
      const [url] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 4 * 60 * 60 * 1000,
      })
      signedUrl = url
    } catch (storageError) {
      await failJob(`Could not sign Firebase Storage URL for ${upload.storage_path}: ${(storageError as Error).message}`)
      return
    }

    const webhookBase = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL
    if (!webhookBase) {
      await failJob("APP_URL/NEXT_PUBLIC_APP_URL env not set — cannot build webhook URL")
      return
    }
    const webhookUrl = `${webhookBase.replace(/\/$/, "")}/api/webhooks/assemblyai?ai_job_id=${jobId}`

    const transcript = await submitTranscription({
      audio_url: signedUrl,
      webhook_url: webhookUrl,
    })

    await supabase.from("video_uploads").update({ status: "transcribing" }).eq("id", upload.id)

    await jobRef.update({
      assemblyaiTranscriptId: transcript.id,
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown transcription error")
  }
}
