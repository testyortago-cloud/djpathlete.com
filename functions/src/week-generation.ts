import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getDatabase } from "firebase-admin/database"
import { generateWeekSync } from "./ai/week-orchestrator.js"
import type { WeekGenerationRequest } from "./ai/week-orchestrator.js"
import { notifyJobCompleted, notifyJobFailed } from "./lib/notify-job-done.js"
import { createDeadline, DeadlineExceededError } from "./lib/deadline.js"

/**
 * Wall-clock budget for the orchestration, strictly inside the function's
 * `timeoutSeconds` (540s — the hard Eventarc ceiling for event-triggered gen2
 * functions; see index.ts weekGeneration). The ~90s gap is deliberate: when the
 * budget blows we still need live container time to write status="failed" to
 * Firestore + RTDB and send the failure email. A hard platform kill skips all of
 * that and leaves the job wedged in "processing" forever, unrecoverable because
 * the trigger guard skips non-"pending" docs.
 */
const WEEK_GENERATION_BUDGET_MS = 450_000 // 7.5 min

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
    notify_email?: string | null
  }

  // Day generation goes through the same path with target_day_of_week set;
  // surface it in the email subject so the recipient knows which scope ran.
  const isDayJob = typeof input.request.target_day_of_week === "number"
  const isTargetedWeek = typeof input.request.target_week_number === "number"

  const deadline = createDeadline(WEEK_GENERATION_BUDGET_MS, "Week generation")

  try {
    console.log(`[week-generation] Starting for job ${jobId}`)
    const result = await generateWeekSync(input.request, input.requestedBy, jobId, deadline)

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

    const jobLabel = isDayJob
      ? `Week ${result.new_week_number} / Day ${input.request.target_day_of_week}`
      : isTargetedWeek
        ? `Week ${result.new_week_number} (fill)`
        : `Week ${result.new_week_number}`

    await notifyJobCompleted({
      notify_email: input.notify_email,
      programId: input.request.program_id,
      jobLabel,
      summary: `${result.exercises_added} exercises added in ${Math.round(result.duration_ms / 1000)}s.`,
    })
  } catch (error) {
    let errorMessage = error instanceof Error ? error.message : "Unknown error"
    // A timeout is the one failure the coach can act on directly, so say how.
    if (error instanceof DeadlineExceededError) {
      errorMessage +=
        " No exercises were written. Retry with a smaller exercise pool (or none)," +
        " fewer exercises per day, or generate one day at a time."
    }
    console.error(`[week-generation] Job ${jobId} failed:`, errorMessage)

    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })

    await updateRtdb(jobId, { status: "failed", error: errorMessage })

    await notifyJobFailed({
      notify_email: input.notify_email,
      programId: input.request.program_id,
      jobLabel: isDayJob ? "Day generation" : "Week generation",
      error: errorMessage,
    })
  } finally {
    // Release the timer on every path — a live timer could otherwise abort a
    // reused container's next invocation.
    deadline.dispose()
  }
}
