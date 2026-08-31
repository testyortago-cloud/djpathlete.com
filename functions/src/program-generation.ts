import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getDatabase } from "firebase-admin/database"
import { generateProgramSync } from "./ai/orchestrator.js"
import type { AiGenerationRequest, AssessmentContext } from "./ai/orchestrator.js"
import { notifyJobCompleted, notifyJobFailed } from "./lib/notify-job-done.js"
import { createDeadline, DeadlineExceededError } from "./lib/deadline.js"

/**
 * Wall-clock budget for the orchestration, strictly inside the function's
 * `timeoutSeconds` (540s — the hard Eventarc ceiling for event-triggered gen2
 * functions; see index.ts programGeneration). The ~90s gap leaves live
 * container time to record the outcome and email the coach; a hard platform
 * kill skips all of that and wedges the job in "processing" forever.
 *
 * A program is built one week at a time and cannot be finished in one
 * invocation past ~3 weeks, so blowing this budget is NOT a failure: the
 * orchestrator saves every week it finished and queues the rest (see
 * ai/generation-continuation.ts).
 */
const PROGRAM_GENERATION_BUDGET_MS = 450_000 // 7.5 min

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

  const deadline = createDeadline(PROGRAM_GENERATION_BUDGET_MS, "Program generation")

  try {
    console.log(`[program-generation] Starting for job ${jobId}`)
    const result = await generateProgramSync(
      input.request,
      input.requestedBy,
      input.assessmentContext,
      input.logId,
      jobId,
      undefined,
      deadline,
      input.notify_email ?? null,
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
      partial: result.partial ?? null,
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

    // A partial run emails nothing here: the continuation chain is still
    // building the remaining weeks and its last link sends the one "ready"
    // message. Two emails for one program reads as a bug to the coach.
    if (result.partial) {
      console.log(
        `[program-generation] Job ${jobId} saved ${result.partial.weeks_completed}/${result.partial.total_weeks} weeks; week ${result.partial.next_week} continues as job ${result.partial.continuation_job_id ?? "NONE"}`,
      )
      if (!result.partial.continuation_job_id) {
        // The chain never started, so nothing else will finish this program or
        // tell the coach about it. This is the one partial case worth an email.
        await notifyJobFailed({
          notify_email: input.notify_email,
          programId: result.program_id,
          jobLabel: "Full program",
          error:
            `Saved weeks 1-${result.partial.weeks_completed} of ${result.partial.total_weeks}, but the follow-up job could not be queued. ` +
            `Open the program and use "Generate week" from week ${result.partial.next_week} to finish it.`,
        })
      }
      return
    }

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
    let errorMessage = error instanceof Error ? error.message : "Unknown error"
    // Reaching here with a blown budget means not even the first week finished,
    // so nothing was saved. Say what the coach can actually change.
    if (error instanceof DeadlineExceededError) {
      errorMessage +=
        " No week could be completed, so nothing was saved. Retry with fewer" +
        " exercises per session, fewer sessions per week, or a smaller exercise pool."
    }
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
  } finally {
    // Release the timer on every path — a live timer could otherwise abort a
    // reused container's next invocation.
    deadline.dispose()
  }
}
