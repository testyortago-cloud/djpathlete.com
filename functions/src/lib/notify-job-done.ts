// functions/src/lib/notify-job-done.ts
// Generic "long-running AI job is done" emailer. Used by program-generation
// and week-generation handlers so the admin can fire-and-forget a generation
// and walk away — they get an email with a link to the result.
//
// Recipient comes from input.notify_email on the Firestore job doc (set by
// the Next.js API route from the admin's session.user.email when the
// "Email me when done" checkbox is on). When notify_email is null/missing,
// this is a no-op — preserves the opt-in contract.
//
// The COACH_EMAIL fallback that week-generation.ts used unconditionally is
// kept as an additional CC recipient when set, so the coach still sees the
// notification even when notify_email is the assigned client's address.

import { Resend } from "resend"
import { getSupabase } from "./supabase.js"

interface JobSuccessInput {
  /** Address from input.notify_email — null/empty disables the send. */
  notify_email: string | null | undefined
  programId: string | null
  /** "Full program" | "Week 4" | "Week 4 / Day 2" — used verbatim in subject. */
  jobLabel: string
  /** One-line summary for the email body (e.g. "Generated 28 exercises in 42s"). */
  summary: string
  /** Optional extra detail rows for the email body. */
  details?: Array<{ label: string; value: string }>
  /** Link target — defaults to the program admin page if a programId is provided. */
  targetUrl?: string
}

interface JobFailureInput {
  notify_email: string | null | undefined
  programId: string | null
  jobLabel: string
  error: string
  targetUrl?: string
}

function getBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://www.darrenjpaul.com"
  )
}

function getFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL ?? "DJP Athlete <noreply@darrenjpaul.com>"
}

async function resolveProgramName(programId: string | null): Promise<string> {
  if (!programId) return "Program"
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from("programs")
      .select("name")
      .eq("id", programId)
      .single()
    return (data?.name as string | undefined) ?? "Program"
  } catch {
    return "Program"
  }
}

/**
 * Builds the recipient list. Always includes notify_email when set, plus
 * COACH_EMAIL as a CC when configured AND different from notify_email
 * (Resend dedupes, but being explicit avoids any provider quirks).
 */
function buildRecipients(notify_email: string | null | undefined): string[] | null {
  const recipients: string[] = []
  const trimmed = notify_email?.trim()
  if (trimmed) recipients.push(trimmed)
  const coach = process.env.COACH_EMAIL?.trim()
  if (coach && coach.toLowerCase() !== trimmed?.toLowerCase()) {
    recipients.push(coach)
  }
  return recipients.length > 0 ? recipients : null
}

/** Fire-and-forget success email. Swallows errors — never blocks the job.
 *  Every code path emits a log line so failures aren't silent. */
export async function notifyJobCompleted(opts: JobSuccessInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn(
      `[notify-job-done] skip success email: RESEND_API_KEY is not set in the function env`,
    )
    return
  }
  const recipients = buildRecipients(opts.notify_email)
  if (!recipients) {
    console.warn(
      `[notify-job-done] skip success email: no recipients resolved (notify_email=${
        opts.notify_email ?? "null"
      }, COACH_EMAIL_set=${process.env.COACH_EMAIL ? "yes" : "no"})`,
    )
    return
  }

  try {
    const programName = await resolveProgramName(opts.programId)
    const targetUrl =
      opts.targetUrl ??
      (opts.programId ? `${getBaseUrl()}/admin/programs/${opts.programId}` : getBaseUrl())

    const detailsHtml =
      opts.details && opts.details.length > 0
        ? `<ul>${opts.details
            .map((d) => `<li><strong>${d.label}:</strong> ${d.value}</li>`)
            .join("")}</ul>`
        : ""

    const resend = new Resend(apiKey)
    const sendResult = await resend.emails.send({
      from: getFromEmail(),
      to: recipients,
      subject: `✓ ${opts.jobLabel} ready — ${programName}`,
      html: `
        <p><strong>${opts.jobLabel}</strong> for <strong>${programName}</strong> is ready.</p>
        <p>${opts.summary}</p>
        ${detailsHtml}
        <p><a href="${targetUrl}">Open in admin →</a></p>
      `,
    })
    if (sendResult.error) {
      console.warn(
        `[notify-job-done] Resend rejected success email (to=${recipients.join(",")}):`,
        sendResult.error,
      )
    } else {
      console.log(
        `[notify-job-done] success email sent (to=${recipients.join(",")}, id=${sendResult.data?.id ?? "?"})`,
      )
    }
  } catch (e) {
    console.warn(`[notify-job-done] success email threw:`, e)
  }
}

/** Fire-and-forget failure email. Swallows errors — never blocks the job. */
export async function notifyJobFailed(opts: JobFailureInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn(
      `[notify-job-done] skip failure email: RESEND_API_KEY is not set in the function env`,
    )
    return
  }
  const recipients = buildRecipients(opts.notify_email)
  if (!recipients) {
    console.warn(
      `[notify-job-done] skip failure email: no recipients resolved (notify_email=${
        opts.notify_email ?? "null"
      }, COACH_EMAIL_set=${process.env.COACH_EMAIL ? "yes" : "no"})`,
    )
    return
  }

  try {
    const programName = await resolveProgramName(opts.programId)
    const targetUrl =
      opts.targetUrl ??
      (opts.programId ? `${getBaseUrl()}/admin/programs/${opts.programId}` : getBaseUrl())

    const resend = new Resend(apiKey)
    const sendResult = await resend.emails.send({
      from: getFromEmail(),
      to: recipients,
      subject: `✗ ${opts.jobLabel} FAILED — ${programName}`,
      html: `
        <p><strong>${opts.jobLabel}</strong> for <strong>${programName}</strong> failed.</p>
        <pre style="background:#f4f4f4;padding:12px;border-radius:6px;white-space:pre-wrap;font-family:monospace;font-size:12px">${opts.error.slice(0, 1500)}</pre>
        <p><a href="${targetUrl}">Open in admin →</a></p>
      `,
    })
    if (sendResult.error) {
      console.warn(
        `[notify-job-done] Resend rejected failure email (to=${recipients.join(",")}):`,
        sendResult.error,
      )
    } else {
      console.log(
        `[notify-job-done] failure email sent (to=${recipients.join(",")}, id=${sendResult.data?.id ?? "?"})`,
      )
    }
  } catch (e) {
    console.warn(`[notify-job-done] failure email threw:`, e)
  }
}
