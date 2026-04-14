import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getDatabase } from "firebase-admin/database"
import { generateWeekSync } from "./ai/week-orchestrator.js"
import type { WeekGenerationRequest } from "./ai/week-orchestrator.js"

/** Write real-time status to RTDB so the client can listen for instant updates */
async function updateRtdb(jobId: string, data: Record<string, unknown>) {
  try {
    const rtdb = getDatabase()
    await rtdb.ref(`ai_jobs/${jobId}`).update({ ...data, updatedAt: Date.now() })
  } catch (e) {
    console.warn(`[week-generation] RTDB update failed:`, e)
  }
}

export async function handleWeekGeneration(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) {
    console.error(`[week-generation] Job ${jobId} not found`)
    return
  }

  const job = jobSnap.data()!
  if (job.status !== "pending") {
    console.log(`[week-generation] Job ${jobId} already ${job.status}, skipping`)
    return
  }

  // Double-check not cancelled
  const freshSnap = await jobRef.get()
  if (freshSnap.data()?.status === "cancelled") {
    console.log(`[week-generation] Job ${jobId} was cancelled before processing`)
    return
  }

  // Mark as processing
  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })
  await updateRtdb(jobId, { status: "processing" })

  const input = job.input as {
    request: WeekGenerationRequest
    requestedBy: string
  }

  try {
    console.log(`[week-generation] Starting for job ${jobId}`)
    const result = await generateWeekSync(input.request, input.requestedBy, jobId)

    const resultPayload = {
      new_week_number: result.new_week_number,
      exercises_added: result.exercises_added,
      token_usage: result.token_usage,
      duration_ms: result.duration_ms,
    }

    await jobRef.update({
      status: "completed",
      result: resultPayload,
      updatedAt: FieldValue.serverTimestamp(),
    })

    await updateRtdb(jobId, { status: "completed", result: resultPayload })

    console.log(
      `[week-generation] Job ${jobId} completed — Week ${result.new_week_number}, ${result.exercises_added} exercises`,
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[week-generation] Job ${jobId} failed:`, errorMessage)

    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })

    await updateRtdb(jobId, { status: "failed", error: errorMessage })
  }
}
