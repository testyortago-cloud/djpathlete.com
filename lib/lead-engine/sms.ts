// lib/lead-engine/sms.ts — settings-driven SMS for the Lead Engine sequence
// engine.
//
// Mirrors lib/lead-engine/email.ts in structure and rules: every piece of
// business identity — which sender to use — comes from
// `settings: BusinessSettings`, a parameter, never a constant in this file.
// `renderSequenceSms` is pure specifically so it is testable without a
// database and so a brand literal has nowhere to hide:
// `__tests__/lib/lead-engine/no-brand-literals.test.ts` scans this file (and
// the rest of `lib/lead-engine/`) on disk for exactly that.
//
// Plain `fetch` against Twilio's REST API, not the `twilio` npm SDK: this
// module makes one authenticated form POST (and, in a later task, verifies
// one webhook HMAC signature). Spec §3 sanctions this fallback — one POST
// plus one HMAC check does not justify a dependency, and the module's public
// surface would look identical either way.

import type { BusinessSettings } from "@/lib/db/businesses"

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01"

/**
 * 3 GSM-7 segments at 153 chars each. A message over this length is still
 * sent — it just bills and renders as multiple parts — so this is a warning
 * threshold, never a block.
 */
const GSM7_THREE_SEGMENT_LIMIT = 459

/**
 * Appended to every outbound sequence text, exactly once. The STOP
 * consent-revocation row and the seeded SMS copy both reference this same
 * constant so the wording cannot drift — the `UNSUBSCRIBE_FOOTER_SENTENCE`
 * pattern from email.ts.
 */
export const SMS_OPT_OUT_SENTENCE = "Reply STOP to opt out, HELP for help."

/**
 * Thrown by `assertSmsSendable` when neither `sms_messaging_service_sid` nor
 * `sms_sender_phone` is set on `business_settings`.
 *
 * Carries `missing` so a caller can name the gap rather than restate the
 * message — mirrors `BusinessNotConfiguredError` in email.ts. The two fields
 * are an either/or pair (either is sufficient to send), so `missing` names
 * that pair as a single entry rather than listing both columns as if each
 * were independently required.
 */
export class SmsNotConfiguredError extends Error {
  readonly missing: string[]

  constructor(missing: string[]) {
    super(`sms not configured: ${missing.join(", ")}`)
    this.name = "SmsNotConfiguredError"
    this.missing = missing
  }
}

/**
 * True when either the messaging service SID or the sender phone is
 * non-blank — either is sufficient to send.
 */
export function smsConfigured(settings: BusinessSettings): boolean {
  return Boolean(settings.sms_messaging_service_sid?.trim()) || Boolean(settings.sms_sender_phone?.trim())
}

/**
 * Preflight for the SMS send path, mirroring `assertSendable` in email.ts.
 * Migration 00221 seeds both `sms_messaging_service_sid` and
 * `sms_sender_phone` as `NOT NULL DEFAULT ''`, so an unconfigured business —
 * every install before a human runs the ops script the day Twilio clears —
 * is the default state, not an edge case.
 */
export function assertSmsSendable(settings: BusinessSettings): void {
  if (!smsConfigured(settings)) {
    throw new SmsNotConfiguredError(["sms_messaging_service_sid|sms_sender_phone"])
  }
}

/**
 * `{{name}}` substitution. Falls back to an empty string — never a brand
 * word, never a guessed name — the same fallback contract as email.ts's
 * `substituteName`. Reimplemented locally rather than imported: that
 * function is not exported, and this file must not reach into email.ts's
 * internals to get it.
 */
function substituteName(template: string, contactName: string | null): string {
  const safeName = contactName?.replace(/[\r\n]+/g, " ").trim() ?? ""
  return template.replaceAll("{{name}}", safeName)
}

/**
 * Renders a sequence step's body into the exact text handed to the
 * provider. Pure: no I/O, no environment reads, no database. The opt-out
 * sentence is appended exactly once, after a blank line, so it reads as a
 * separate line and never merges into the message copy.
 */
export function renderSequenceSms(args: { body: string; contactName: string | null }): { text: string } {
  const body = substituteName(args.body, args.contactName)
  return { text: `${body}\n\n${SMS_OPT_OUT_SENTENCE}` }
}

/**
 * Sends an ALREADY-RENDERED sequence text via Twilio's Messages API.
 *
 * Uses the messaging service when `settings.sms_messaging_service_sid` is
 * set, else the sender phone — the same either/or the preflight enforces.
 *
 * Missing env (`TWILIO_ACCOUNT_SID`, `TWILIO_MAIN_SID`, `TWILIO_CLIENT_SECRET`)
 * fails safe: console.warn and a null provider id, no fetch call — the same
 * resend-guard pattern as `lib/lead-engine/email.ts:24-34`. A drifted env in
 * production and a test that forgets to mock `fetch` both fail safe instead
 * of reaching the live API.
 *
 * Credentials authenticate as the API key pair (`TWILIO_MAIN_SID` +
 * `TWILIO_CLIENT_SECRET`), never the account auth token — that token is
 * reserved for webhook signature validation only (spec §3's ruling).
 */
export async function sendRenderedSequenceSms(args: {
  to: string
  text: string
  settings: BusinessSettings
  statusCallbackUrl?: string
}): Promise<{ providerMessageId: string | null }> {
  const { to, text, settings, statusCallbackUrl } = args

  if (text.length > GSM7_THREE_SEGMENT_LIMIT) {
    console.warn(
      `[lead-engine/sms] message is ${text.length} chars — exceeds ${GSM7_THREE_SEGMENT_LIMIT} (3 GSM-7 segments); sending anyway`,
    )
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const apiKeySid = process.env.TWILIO_MAIN_SID
  const apiKeySecret = process.env.TWILIO_CLIENT_SECRET
  if (!accountSid || !apiKeySid || !apiKeySecret) {
    console.warn(`[lead-engine/sms] Twilio env not set — skipping send to "${to}"`)
    return { providerMessageId: null }
  }

  const form = new URLSearchParams()
  form.set("To", to)
  form.set("Body", text)
  if (settings.sms_messaging_service_sid?.trim()) {
    form.set("MessagingServiceSid", settings.sms_messaging_service_sid)
  } else {
    form.set("From", settings.sms_sender_phone)
  }
  if (statusCallbackUrl) {
    form.set("StatusCallback", statusCallbackUrl)
  }

  const auth = Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString("base64")
  const response = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  })

  const json = (await response.json()) as { sid?: string; code?: number; message?: string }

  if (!response.ok) {
    throw new Error(`sendRenderedSequenceSms failed: [${json.code}] ${json.message}`)
  }

  return { providerMessageId: json.sid ?? null }
}
