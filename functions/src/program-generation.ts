import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getDatabase } from "firebase-admin/database"
import { generateProgramSync } from "./ai/orchestrator.js"
import type { AiGenerationRequest, AssessmentContext } from "./ai/orchestrator.js"
import { notifyJobCompleted, notifyJobFailed } from "./lib/notify-job-done.js"

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

  // Double-check not cancelled between creation and pickup
  const freshSnap = await jobRef.get()
  if (freshSnap.data()?.status === "cancelled") {
    console.log(`[program-generation] Job ${jobId} was cancelled before processing`)
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
    notify_email?: string | null
  }

  try {
    console.log(`[program-generation] Starting for job ${jobId}`)
    const result = await generateProgramSync(
      input.request,
      input.requestedBy,
      input.assessmentContext,
      input.logId,
      jobId,
    )

    const resultPayload = {
      program_id: result.program_id,
      validation: {
        pass: result.validation.pass,
        issues: result.validation.issues,
        summary: result.validation.summary,
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

    await notifyJobCompleted({
      notify_email: input.notify_email,
      programId: result.program_id,
      jobLabel: "Full program",
      summary: `Generated in ${Math.round(result.duration_ms / 1000)}s.`,
      details: [
        {
          label: "Validation",
          value:
            resultPayload.validation.errors > 0
              ? `${resultPayload.validation.errors} error(s), ${resultPayload.validation.warnings} warning(s)`
              : `passed${resultPayload.validation.warnings > 0 ? ` with ${resultPayload.validation.warnings} warning(s)` : ""}`,
        },
        { label: "Retries", value: String(result.retries ?? 0) },
        {
          label: "Tokens",
          value: result.token_usage?.total
            ? result.token_usage.total.toLocaleString()
            : "n/a",
        },
      ],
    })
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

    await notifyJobFailed({
      notify_email: input.notify_email,
      programId: null,
      jobLabel: "Full program",
      error: errorMessage,
    })
  }
}
