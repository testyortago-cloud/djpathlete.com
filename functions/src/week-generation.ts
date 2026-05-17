import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getDatabase } from "firebase-admin/database"
import { Resend } from "resend"
import { generateWeekSync } from "./ai/week-orchestrator.js"
import type { WeekGenerationRequest } from "./ai/week-orchestrator.js"
import { getSupabase } from "./lib/supabase.js"

/** Write real-time status to RTDB so the client can listen for instant updates */
async function updateRtdb(jobId: string, data: Record<string, unknown>) {
  try {
    const rtdb = getDatabase()
    await rtdb.ref(`ai_jobs/${jobId}`).update({ ...data, updatedAt: Date.now() })
  } catch (e) {
    console.warn(`[week-generation] RTDB update failed:`, e)
  }
}

/**
 * Fire-and-forget completion email so the coach doesn't have to babysit the
 * dialog. Skips silently if COACH_EMAIL or RESEND_API_KEY isn't configured.
 */
async function sendCompletionEmail(opts: {
  programId: string
  newWeekNumber: number
  exercisesAdded: number
  durationMs: number
}) {
  const recipient = process.env.COACH_EMAIL
  const apiKey = process.env.RESEND_API_KEY
  if (!recipient || !apiKey) return

  try {
    const supabase = getSupabase()
    const { data: program } = await supabase
      .from("programs")
      .select("name")
      .eq("id", opts.programId)
      .single()
    const programName = program?.name ?? "Program"

    const baseUrl =
      process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.darrenjpaul.com"
    const programUrl = `${baseUrl}/admin/programs/${opts.programId}`
    const durationSec = Math.round(opts.durationMs / 1000)
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "DJP Athlete <noreply@darrenjpaul.com>"

    const resend = new Resend(apiKey)
    await resend.emails.send({
      from: fromEmail,
      to: recipient,
      subject: `AI Week ${opts.newWeekNumber} ready — ${programName} (${opts.exercisesAdded} exercises)`,
      html: `
        <p>Week ${opts.newWeekNumber} for <strong>${programName}</strong> has been generated.</p>
        <ul>
          <li><strong>${opts.exercisesAdded}</strong> exercises added</li>
          <li>Generation time: ${durationSec}s</li>
        </ul>
        <p><a href="${programUrl}">Open the program</a></p>
      `,
    })
  } catch (e) {
    console.warn(`[week-generation] Completion email failed:`, e)
  }
}

async function sendFailureEmail(opts: { programId: string; error: string }) {
  const recipient = process.env.COACH_EMAIL
  const apiKey = process.env.RESEND_API_KEY
  if (!recipient || !apiKey) return

  try {
    const supabase = getSupabase()
    const { data: program } = await supabase
      .from("programs")
      .select("name")
      .eq("id", opts.programId)
      .single()
    const programName = program?.name ?? "Program"

    const baseUrl =
      process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.darrenjpaul.com"
    const programUrl = `${baseUrl}/admin/programs/${opts.programId}`
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "DJP Athlete <noreply@darrenjpaul.com>"

    const resend = new Resend(apiKey)
    await resend.emails.send({
      from: fromEmail,
      to: recipient,
      subject: `AI week generation FAILED — ${programName}`,
      html: `
        <p>Week generation for <strong>${programName}</strong> failed.</p>
        <pre style="background:#f4f4f4;padding:12px;border-radius:6px;white-space:pre-wrap">${opts.error}</pre>
        <p><a href="${programUrl}">Open the program</a></p>
      `,
    })
  } catch (e) {
    console.warn(`[week-generation] Failure email failed:`, e)
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

    await sendCompletionEmail({
      programId: input.request.program_id,
      newWeekNumber: result.new_week_number,
      exercisesAdded: result.exercises_added,
      durationMs: result.duration_ms,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[week-generation] Job ${jobId} failed:`, errorMessage)

    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })

    await updateRtdb(jobId, { status: "failed", error: errorMessage })

    await sendFailureEmail({
      programId: input.request.program_id,
      error: errorMessage,
    })
  }
}
