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
import { isSuppressed } from "@/lib/db/contact-consents"
import { insertSmsMessage } from "@/lib/db/sms-messages"
import { normalisePhone } from "@/lib/lead-engine/identity"

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
 * True iff all three Twilio credential env vars `sendRenderedSequenceSms`
 * needs are set and non-blank: `TWILIO_ACCOUNT_SID`, `TWILIO_MAIN_SID`,
 * `TWILIO_CLIENT_SECRET`.
 *
 * `smsConfigured` answers "has a human filled in `business_settings`?";
 * this answers "does THIS deployment actually have Twilio credentials?" —
 * two independent gates. A business can be configured in the DB while a
 * given deployment's env is missing the keys (or vice versa isn't possible,
 * since the DB is the operator-facing switch). The runner's per-tick gate
 * is `smsConfigured(settings) && smsEnvPresent()`, and the two failure modes
 * get distinct timeline reasons (`sms_not_configured` vs `sms_env_missing`)
 * so an operator can tell them apart.
 */
export function smsEnvPresent(): boolean {
  return (
    Boolean(process.env.TWILIO_ACCOUNT_SID?.trim()) &&
    Boolean(process.env.TWILIO_MAIN_SID?.trim()) &&
    Boolean(process.env.TWILIO_CLIENT_SECRET?.trim())
  )
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
 * THROWS naming the missing var(s), rather than warning and returning a null
 * provider id. It used to fail safe that way (the same resend-guard pattern
 * as `lib/lead-engine/email.ts:24-34`) but that pattern is wrong for a
 * caller that then RECORDS the send: the sequence-tick runner would call
 * `markSent(messageId, "twilio", null)` on a message nothing ever
 * transmitted — a permanent "sent" row for something that never left this
 * process. `smsEnvPresent()` exists precisely so a caller can check this
 * BEFORE claiming a `sequence_messages` row at all, the same way the runner
 * already checks `smsConfigured(settings)`; this function still throws
 * defensively for any caller that skips that check (a live env drift or a
 * test that forgets to mock `fetch` fails loud instead of silently
 * fabricating a delivery).
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
    const missing = [
      !accountSid && "TWILIO_ACCOUNT_SID",
      !apiKeySid && "TWILIO_MAIN_SID",
      !apiKeySecret && "TWILIO_CLIENT_SECRET",
    ].filter((v): v is string => Boolean(v))
    throw new Error(`sendRenderedSequenceSms: Twilio env not set: ${missing.join(", ")}`)
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

/**
 * The GSM-7 default alphabet. A message composed only of these characters
 * is sent as 7-bit septets; anything else forces the whole message to
 * UCS-2. Kept as an explicit set rather than a regex range because the
 * alphabet is not contiguous in Unicode.
 */
const GSM7_BASE =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"

/**
 * Characters reachable in GSM-7 only via the escape sequence — each costs
 * TWO septets, not one. A message of 81 euro signs is two segments even
 * though it is 81 characters.
 */
const GSM7_EXTENDED = "^{}\\[~]|€"

const GSM7_BASE_SET = new Set(GSM7_BASE)
const GSM7_EXTENDED_SET = new Set(GSM7_EXTENDED)

/**
 * Counts a message the way Twilio bills it.
 *
 * Single-segment limits are 160 (GSM-7) and 70 (UCS-2). The moment a message
 * needs more than one segment, each part gives up room to a UDH concatenation
 * header: 153 septets, or 67 UTF-16 code units. `characters` is reported in
 * the unit the compose box should show — UTF-16 code units — so an emoji
 * counts as the two units it occupies on the wire.
 */
export function countSmsSegments(text: string): {
  characters: number
  segments: number
  encoding: "GSM-7" | "UCS-2"
  perSegment: number
} {
  const characters = text.length

  let isGsm7 = true
  let septets = 0
  for (const char of text) {
    if (GSM7_BASE_SET.has(char)) {
      septets += 1
    } else if (GSM7_EXTENDED_SET.has(char)) {
      septets += 2
    } else {
      isGsm7 = false
      break
    }
  }

  if (characters === 0) {
    return { characters: 0, segments: 0, encoding: "GSM-7", perSegment: 160 }
  }

  if (isGsm7) {
    if (septets <= 160) return { characters, segments: 1, encoding: "GSM-7", perSegment: 160 }
    return {
      characters,
      segments: Math.ceil(septets / 153),
      encoding: "GSM-7",
      perSegment: 153,
    }
  }

  // UCS-2 counts UTF-16 code units, which is what `text.length` already is.
  if (characters <= 70) return { characters, segments: 1, encoding: "UCS-2", perSegment: 70 }
  return {
    characters,
    segments: Math.ceil(characters / 67),
    encoding: "UCS-2",
    perSegment: 67,
  }
}

/**
 * Renders a manually typed message.
 *
 * Deliberately NOT `renderSequenceSms`: a manual message is typed by a human
 * into a box, so `{{name}}` is literal text they meant to send, not a
 * template to substitute. And the opt-out sentence is conditional here —
 * spec §3.2 puts it on the first outbound to a contact in a rolling 30 days
 * rather than on every reply, because appending it to a one-line reply in a
 * live conversation reads as automated and costs a third of the segment.
 * Sequence sends are unaffected and keep appending every time.
 */
export function renderManualSms(args: { body: string; appendOptOut: boolean }): { text: string } {
  const body = args.body.trimEnd()
  if (!args.appendOptOut) return { text: body }
  return { text: `${body}\n\n${SMS_OPT_OUT_SENTENCE}` }
}

/**
 * Thrown when the destination number has sent STOP. Spec §3.3: this one is
 * not a preference. Carries the phone so a caller can name it.
 */
export class SmsSuppressedError extends Error {
  readonly phone: string
  constructor(phone: string) {
    super(`cannot send: ${phone} has opted out`)
    this.name = "SmsSuppressedError"
    this.phone = phone
  }
}

/**
 * Thrown when `args.phone` cannot be normalised to E.164 at all — it cannot
 * be checked against suppressions, so sending to it can never be proven
 * safe. This is a CALLER INPUT error (a typo, a disconnected or otherwise
 * unassigned number), not a provider failure: a phone can pass the route's
 * `/^\+[1-9]\d{7,14}$/` shape check and still fail libphonenumber's real
 * validation (`+12345678` is shaped like E.164 and is not a real number), so
 * this has to be its own type rather than falling into the generic 502
 * every other `sendManualSms` throw lands in — a 502 tells an admin to try
 * again later, which will never fix a bad number.
 */
export class SmsUnparseablePhoneError extends Error {
  readonly phone: string
  constructor(phone: string) {
    super(`"${phone}" is not a valid phone number; refusing because it cannot be checked against suppressions`)
    this.name = "SmsUnparseablePhoneError"
    this.phone = phone
  }
}

/** A manual message longer than this is refused rather than silently billed. */
const MANUAL_SMS_MAX_SEGMENTS = 10

/**
 * Thrown when a manual message renders to more than `MANUAL_SMS_MAX_SEGMENTS`
 * segments. Zod's 1600-character cap on the route does not catch every case
 * that lands here: a body that is otherwise plain GSM-7 but contains even one
 * non-GSM-7 character (an emoji, most accents) forces the WHOLE message to
 * UCS-2 — 67 characters per segment instead of 153 — so a ~700-character body
 * can pass that cap and still be 11+ segments. Same reasoning as
 * `SmsUnparseablePhoneError`: this is the caller's message being too long,
 * not a provider failure, so the route maps it to 400 with the actual
 * segment count instead of the generic 502.
 */
export class SmsTooLongError extends Error {
  readonly segments: number
  readonly maxSegments: number
  constructor(segments: number, maxSegments: number) {
    super(`message is ${segments} segments (max ${maxSegments}); shorten it`)
    this.name = "SmsTooLongError"
    this.segments = segments
    this.maxSegments = maxSegments
  }
}

/**
 * Sends one manually typed message and records it.
 *
 * THREE CHECKS, failing on the first: suppression -> configuration ->
 * segment length. Suppression is first deliberately: it is the check with
 * legal consequences, and ordering configuration ahead of it would let an
 * unconfigured business mask a suppressed number behind a different error.
 * Ahead of all three, the phone is normalised to E.164 exactly once — the
 * STOP webhook (`app/api/webhooks/twilio/inbound/route.ts`) writes
 * suppressions keyed on Twilio's E.164 `From`, so checking (or recording)
 * against a national-format number would silently match zero rows forever
 * and let a suppressed contact through. This repo has shipped that exact
 * bug once already (`bookings.phone_e164`, see project memory). An
 * unparseable phone is refused outright: it cannot be checked against
 * suppressions at all, so sending to it can never be proven safe.
 *
 * Quiet hours are NOT checked here (spec §3.1). A human replying inside a
 * live conversation is a different act from bulk marketing at 2am; the
 * compose box warns and requires a second click, and `quietHoursDefer` on
 * the sequence path is untouched.
 *
 * THIS FUNCTION THROWS on a send that did not happen. It never returns
 * `{ ok: true }` for one — a success shape returned on an unconfigured
 * deployment is exactly the pattern this must not repeat. A failed
 * provider call still writes a `failed` row before rethrowing, so the
 * conversation shows what happened.
 *
 * The one exception is the FINAL record write, after Twilio has already
 * accepted the message: if that `insertSmsMessage` call itself fails, the
 * text has already gone out, so throwing here would misreport a delivered
 * message as unsent. That failure is logged, not thrown, and `messageId`
 * comes back `null` because there is no row to point to.
 */
export async function sendManualSms(args: {
  phone: string
  body: string
  settings: BusinessSettings
  businessId: string
  contactId?: string | null
  sentBy?: string | null
  appendOptOut: boolean
  statusCallbackUrl?: string
}): Promise<{ messageId: string | null; providerMessageId: string | null; text: string }> {
  const { businessId } = args

  // 0. Normalise once, up front. Every later step — suppression, the send,
  // and both `insertSmsMessage` writes — uses this same E.164 value, so the
  // thread this creates keys on exactly what the inbound webhook uses.
  const phone = normalisePhone(args.phone)
  if (!phone) {
    throw new SmsUnparseablePhoneError(args.phone)
  }

  // 1. Suppression.
  if (await isSuppressed(phone, businessId)) {
    throw new SmsSuppressedError(phone)
  }

  // 2. Configuration. Throws SmsNotConfiguredError.
  assertSmsSendable(args.settings)

  // 3. Segment length.
  const { text } = renderManualSms({ body: args.body, appendOptOut: args.appendOptOut })
  const counted = countSmsSegments(text)
  if (counted.segments > MANUAL_SMS_MAX_SEGMENTS) {
    throw new SmsTooLongError(counted.segments, MANUAL_SMS_MAX_SEGMENTS)
  }

  let providerMessageId: string | null = null
  try {
    ;({ providerMessageId } = await sendRenderedSequenceSms({
      to: phone,
      text,
      settings: args.settings,
      statusCallbackUrl: args.statusCallbackUrl,
    }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Record the attempt before rethrowing: the conversation has to show a
    // failed message, not a gap.
    const codeMatch = message.match(/\[(\d+)\]/)
    await insertSmsMessage({
      businessId,
      contactId: args.contactId ?? null,
      phone,
      direction: "outbound",
      body: text,
      status: "failed",
      errorCode: codeMatch ? codeMatch[1] : null,
      sentBy: args.sentBy ?? null,
    })
    throw err
  }

  // The send already succeeded at this point. A failure recording it must
  // not be reported as a failure to SEND — that would report a delivered
  // text as lost, the same gap-in-the-conversation failure mode the catch
  // block above exists to prevent on the other side.
  let messageId: string | null = null
  try {
    const inserted = await insertSmsMessage({
      businessId,
      contactId: args.contactId ?? null,
      phone,
      direction: "outbound",
      body: text,
      twilioSid: providerMessageId,
      status: "sent",
      sentBy: args.sentBy ?? null,
    })
    messageId = inserted.id
  } catch (err) {
    console.error(
      `[lead-engine/sms] sendManualSms: message to ${phone} sent (provider id ${providerMessageId}) but recording it failed:`,
      err,
    )
  }

  return { messageId, providerMessageId, text }
}
