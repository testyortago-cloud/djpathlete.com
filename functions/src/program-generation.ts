import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getDatabase } from "firebase-admin/database"
import { generateProgramSync } from "./ai/orchestrator.js"
import type { AiGenerationRequest, AssessmentContext } from "./ai/orchestrator.js"

/** Write real-time status to RTDB so the client can listen for instant updates */
async function updateRtdb(jobId: string, data: Record<string, unknown>) {
  try {
    const rtdb = getDatabase()
    await rtdb.ref(`ai_jobs/${jobId}`).update({ ...data, updatedAt: Date.now() })
  } catch (e) {
    console.warn(`[program-generation] RTDB update failed:`, e)
  }
}

export async function handleProgramGeneration(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) {
    console.error(`[program-generation] Job ${jobId} not found`)
    return
  }

  const job = jobSnap.data()!
  if (job.status !== "pending") {
    console.log(`[program-generation] Job ${jobId} already ${job.status}, skipping`)
    return
  }

  // Mark as processing in both Firestore and RTDB
  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })
  await updateRtdb(jobId, { status: "processing" })

  const input = job.input as {
    request: AiGenerationRequest
    requestedBy: string
    logId?: string
    assessmentContext?: AssessmentContext
  }

  try {
    console.log(`[program-generation] Starting for job ${jobId}`)
    const result = await generateProgramSync(
      input.request,
      input.requestedBy,
      input.assessmentContext,
      input.logId,
      jobId
    )

    const resultPayload = {
      program_id: result.program_id,
      validation: {
        pass: result.validation.pass,
        warnings: result.validation.issues.filter((i) => i.type === "warning").length,
        errors: result.validation.issues.filter((i) => i.type === "error").length,
      },
      token_usage: result.token_usage,
      duration_ms: result.duration_ms,
      retries: result.retries,
    }

    // Write result to Firestore (permanent record)
    await jobRef.update({
      status: "completed",
      result: resultPayload,
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Write result to RTDB (real-time client updates)
    await updateRtdb(jobId, { status: "completed", result: resultPayload })

    console.log(`[program-generation] Job ${jobId} completed — program_id: ${result.program_id}`)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[program-generation] Job ${jobId} failed:`, errorMessage)

    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Write error to RTDB so client sees it instantly
    await updateRtdb(jobId, { status: "failed", error: errorMessage })
  }
}
