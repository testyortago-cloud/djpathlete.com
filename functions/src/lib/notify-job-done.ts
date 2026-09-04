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
import {
  emailLayout,
  sectionLabel,
  ctaButton,
  infoCard,
  fallbackLink,
  errorBlock,
} from "./email-template.js"

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
  // Default sender uses the verified send.darrenjpaul.com subdomain on Resend.
  // The apex darrenjpaul.com is NOT verified for sending — using it triggers
  // "domain is not verified" 403s from the Resend API.
  return process.env.RESEND_FROM_EMAIL ?? "DJP Athlete <noreply@send.darrenjpaul.com>"
}

/**
 * Reply-to for both notification emails.
 *
 * These reach CLIENTS, and the From address sits on send.darrenjpaul.com, which
 * Resend has configured for sending only — `receiving` is disabled. So a client
 * who hits Reply on "your program is ready" gets a bounce unless we point the
 * reply somewhere that accepts mail. COACH_EMAIL is the apex, which does.
 *
 * Returns undefined rather than a guessed address when COACH_EMAIL is unset:
 * no Reply-To at all is honest, while a wrong one silently swallows replies.
 */
function getReplyTo(): string | undefined {
  const coach = process.env.COACH_EMAIL?.trim()
  return coach && coach.length > 0 ? coach : undefined
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

    const cardRows: Array<{ label: string; value: string }> = [
      { label: "Program", value: programName },
      { label: "Scope", value: opts.jobLabel },
    ]
    if (opts.details && opts.details.length > 0) {
      for (const d of opts.details) cardRows.push({ label: d.label, value: d.value })
    }

    const html = emailLayout(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding:48px 48px 52px;">
            ${sectionLabel("Generation Complete")}
            <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
              ${opts.jobLabel} is ready.
            </p>
            <p style="margin:0 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
              ${opts.summary}
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:36px;">
              <tr><td>${infoCard(cardRows)}</td></tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td align="center">${ctaButton(targetUrl, "Open in admin")}</td></tr>
            </table>
            ${fallbackLink(targetUrl)}
          </td>
        </tr>
      </table>
    `)

    const fromAddr = getFromEmail()
    const resend = new Resend(apiKey)
    const sendResult = await resend.emails.send({
      from: fromAddr,
      to: recipients,
      replyTo: getReplyTo(),
      subject: `${opts.jobLabel} is ready — ${programName}`,
      html,
    })
    if (sendResult.error) {
      console.warn(
        `[notify-job-done] Resend rejected success email (from=${fromAddr}, to=${recipients.join(",")}):`,
        sendResult.error,
      )
    } else {
      console.log(
        `[notify-job-done] success email sent (from=${fromAddr}, to=${recipients.join(",")}, id=${sendResult.data?.id ?? "?"})`,
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

    const html = emailLayout(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding:48px 48px 52px;">
            ${sectionLabel("Generation Failed")}
            <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
              ${opts.jobLabel} could not be completed.
            </p>
            <p style="margin:0 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
              The generation for <strong>${programName}</strong> failed. The error message below was returned by the orchestrator — open the admin to retry or adjust the request.
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:36px;">
              <tr><td>${errorBlock(opts.error)}</td></tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td align="center">${ctaButton(targetUrl, "Open in admin")}</td></tr>
            </table>
            ${fallbackLink(targetUrl)}
          </td>
        </tr>
      </table>
    `)

    const resend = new Resend(apiKey)
    const sendResult = await resend.emails.send({
      from: getFromEmail(),
      to: recipients,
      replyTo: getReplyTo(),
      subject: `${opts.jobLabel} failed — ${programName}`,
      html,
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
