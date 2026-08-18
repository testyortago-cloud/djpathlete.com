// lib/lead-engine/email.ts — settings-driven email for the Lead Engine
// sequence engine.
//
// Every piece of business identity — sender name, display name, postal
// address, reply-to — comes from `settings: BusinessSettings`, a parameter,
// never a constant in this file. `renderSequenceEmail` is pure specifically
// so it is testable without a database and so a brand literal has nowhere
// to hide: `__tests__/lib/lead-engine/no-brand-literals.test.ts` scans this
// file (and the rest of `lib/lead-engine/`) on disk for exactly that.
//
// Do NOT import from `lib/email.ts`. That file is ~2,800 lines behind 40+
// senders and hardcodes this codebase's own operator brand throughout its
// layout. Only two patterns are borrowed from it here: the Resend SDK guard
// (below) and the general shape of a transactional HTML email.

import { Resend } from "resend"
import { getBusinessSettings, type BusinessSettings } from "@/lib/db/businesses"

const _resendClient = new Resend(process.env.RESEND_API_KEY)

// Mirrors the guard in lib/email.ts: every callsite short-circuits when
// RESEND_API_KEY is missing, so a drifted env in production and a test that
// forgets to mock `resend` both fail safe instead of reaching the live API.
const resend = {
  emails: {
    send: (async (args: Parameters<typeof _resendClient.emails.send>[0]) => {
      if (!process.env.RESEND_API_KEY) {
        console.warn(`[lead-engine/email] RESEND_API_KEY not set — skipping "${args.subject}"`)
        return { data: null, error: null }
      }
      return _resendClient.emails.send(args)
    }) as typeof _resendClient.emails.send,
  },
}

/**
 * The exact sentence carrying the unsubscribe link, rendered into every
 * sequence email footer. Task 6 (consent revocation) stamps this same
 * constant into the NOT NULL `wording_shown` column on the consent row it
 * writes when a contact unsubscribes — the two must never drift, which is
 * why this is a shared export rather than a string duplicated in two
 * places.
 */
export const UNSUBSCRIBE_FOOTER_SENTENCE =
  "If you no longer want to receive these emails, you can unsubscribe at any time."

/**
 * Thrown by `assertSendable` when `business_settings` has not been filled in.
 *
 * Carries `missing` so a caller can name the fields rather than restate the
 * message. The sequence tick's route handler catches this specifically and
 * answers 200, not 500: the caller is a scheduler, and a 500 only buys an
 * infinite retry of a misconfiguration no retry can fix.
 */
export class BusinessNotConfiguredError extends Error {
  readonly missing: string[]

  constructor(missing: string[]) {
    super(`business_settings not configured: ${missing.join(", ")}`)
    this.name = "BusinessNotConfiguredError"
    this.missing = missing
  }
}

/**
 * Preflight for the whole send path. Migration 00212 seeds every identity
 * column as `NOT NULL DEFAULT ''` and nothing in this codebase calls
 * `updateBusinessSettings`, so an untouched install would send
 * `from: " <>"` with an empty postal address — Resend rejects it, and every
 * run that reached the provider would be marked permanently `failed` with no
 * re-activation path.
 *
 * Called BEFORE any run is claimed (see `runSequenceTick`) precisely so that
 * an unconfigured business claims nothing and fails nothing.
 *
 * The three fields checked here are the ones whose emptiness is fatal or
 * unlawful: `sender_email` (Resend rejects an empty From address),
 * `display_name` (the email would identify nobody) and `postal_address`
 * (CAN-SPAM requires a physical address in every commercial message).
 */
export function assertSendable(settings: BusinessSettings): void {
  const missing: string[] = []
  if (!settings.sender_email?.trim()) missing.push("sender_email")
  if (!settings.display_name?.trim()) missing.push("display_name")
  if (!settings.postal_address?.trim()) missing.push("postal_address")
  if (missing.length > 0) throw new BusinessNotConfiguredError(missing)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** `{{name}}` substitution. Falls back to an empty string — never a brand word, never a guessed name. */
function substituteName(template: string, contactName: string | null): string {
  return template.replaceAll("{{name}}", contactName ?? "")
}

/**
 * Renders a sequence step's subject/body into a full email. Pure: no I/O,
 * no environment reads, no database. Every identifying string comes from
 * `args.settings`.
 */
export function renderSequenceEmail(args: {
  settings: BusinessSettings
  subject: string
  body: string
  unsubscribeUrl: string
  contactName: string | null
}): { subject: string; html: string; text: string } {
  const { settings, unsubscribeUrl, contactName } = args
  const subject = substituteName(args.subject, contactName)
  const body = substituteName(args.body, contactName)

  const bodyParagraphsHtml = body
    .split(/\n{2,}/)
    .filter((para) => para.length > 0)
    .map((para) => `<p style="margin:0 0 16px; white-space:pre-line;">${escapeHtml(para)}</p>`)
    .join("\n")

  const headerHtml = settings.logo_url
    ? `<img src="${escapeHtml(settings.logo_url)}" alt="${escapeHtml(settings.display_name)}" style="max-height:48px; margin-bottom:24px; border:0;" />`
    : `<p style="margin:0 0 24px; font-weight:600; font-size:16px;">${escapeHtml(settings.display_name)}</p>`

  // The footer's identity + unsubscribe lines render unconditionally — a
  // missing postal address is a CAN-SPAM violation, so nothing here may be
  // gated on personalization, body content, or any other optional input.
  const footerHtml = `
    <p style="margin:0 0 8px;">${escapeHtml(settings.display_name)}</p>
    <p style="margin:0 0 8px;">Sent by ${escapeHtml(settings.sender_name)} &middot; ${escapeHtml(settings.postal_address)}</p>
    <p style="margin:0;">${escapeHtml(UNSUBSCRIBE_FOOTER_SENTENCE)} <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>
  `.trim()

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f4; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#222;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background:#ffffff;">
          <tr>
            <td style="padding:32px 32px 16px;">
              ${headerHtml}
              ${bodyParagraphsHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 32px; border-top:1px solid #e5e5e5; font-size:12px; color:#777; line-height:1.6;">
              ${footerHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim()

  const text = [
    body,
    "",
    "---",
    settings.display_name,
    `Sent by ${settings.sender_name} · ${settings.postal_address}`,
    `${UNSUBSCRIBE_FOOTER_SENTENCE} ${unsubscribeUrl}`,
  ].join("\n")

  return { subject, html, text }
}

/**
 * Renders and sends one sequence email via Resend. When `settings` is
 * omitted it is loaded from `business_settings` — pass it explicitly (as
 * `sequence-tick-runner.ts` will, having already loaded it once per tick)
 * to avoid a redundant read.
 */
export async function sendSequenceEmail(args: {
  to: string
  subject: string
  body: string
  unsubscribeUrl: string
  contactName: string | null
  settings?: BusinessSettings
}): Promise<{ providerMessageId: string | null }> {
  const settings = args.settings ?? (await getBusinessSettings())

  const { subject, html, text } = renderSequenceEmail({
    settings,
    subject: args.subject,
    body: args.body,
    unsubscribeUrl: args.unsubscribeUrl,
    contactName: args.contactName,
  })

  const { data, error } = await resend.emails.send({
    from: `${settings.sender_name} <${settings.sender_email}>`,
    to: args.to,
    replyTo: settings.reply_to,
    subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${args.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  })

  if (error) {
    throw new Error(`sendSequenceEmail failed: ${error.message}`)
  }

  return { providerMessageId: data?.id ?? null }
}
