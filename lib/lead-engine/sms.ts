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
import type { EnrolmentMetadata } from "@/lib/lead-engine/enrolment-metadata"
import { substituteMergeFields } from "@/lib/lead-engine/merge-fields"
import { isSuppressed, hasConsent } from "@/lib/db/contact-consents"
import { insertSmsMessage, markSmsMessageOutcome } from "@/lib/db/sms-messages"
import { normalisePhone } from "@/lib/lead-engine/identity"
import { countSmsSegments } from "@/lib/lead-engine/sms-segments"

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
 * Renders a sequence step's body into the exact text handed to the
 * provider. Pure: no I/O, no environment reads, no database. The opt-out
 * sentence is appended exactly once, after a blank line, so it reads as a
 * separate line and never merges into the message copy.
 *
 * SHARES THE EMAIL'S MERGE FIELDS, and it has to. This file used to carry its
 * own `substituteName`, duplicated because email.ts's was not exported — and
 * that duplicate is exactly how a text came to understand `{{name}}` and
 * nothing else. G16 gave the editor a warning listing every usable token
 * UNDER THE TEXT BOX TOO, so a coach typing `{{first_name}}` into a text saw
 * no warning and the handset got the literal braces: the precise failure the
 * feature exists to prevent, reintroduced by two renderers disagreeing about
 * one list. `lib/lead-engine/merge-fields.ts` is pure and exported, so there is
 * no longer any reason for a second copy.
 */
export function renderSequenceSms(args: {
  body: string
  contactName: string | null
  /** What the enrolling event let this run remember (G10) — same source as the email's. */
  enrolmentMetadata?: EnrolmentMetadata
}): { text: string } {
  const body = substituteMergeFields(args.body, {
    contactName: args.contactName,
    metadata: args.enrolmentMetadata,
  })
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

// `countSmsSegments` now lives in ./sms-segments — a pure module with no
// database import, so the compose box can count segments in the browser
// without dragging lib/supabase (and therefore next/headers) into the
// client bundle. Re-exported here so every existing caller is unchanged.
export { countSmsSegments }

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

/**
 * G28. Thrown when the destination has no GRANTED `sms` consent row and the
 * sender did not tick "Send anyway". Carries the NORMALISED phone so the
 * route can name the number the same way every other refusal here does.
 *
 * DIFFERENT IN KIND FROM `SmsSuppressedError`, and the difference is the
 * whole design. A suppression is a STOP — the person told us to go away, it
 * is not a preference, and nothing in the product may override it. Missing
 * consent is an ABSENCE of a recorded yes, which a coach with a real reason
 * (a reply to an inbound question, a client they are mid-conversation with)
 * can proceed past, on the record. So this one is overridable and that one
 * is not.
 *
 * WHAT THIS COSTS ON DAY ONE, measured: `contact_consents` has ZERO rows in
 * production, so this refuses EVERY manual text until consent starts being
 * recorded. That is not a bug in the gate and it is not a surprise — the
 * owner ruled for it knowing the count, on 2026-09-21.
 */
export class SmsNoConsentError extends Error {
  readonly phone: string
  constructor(phone: string) {
    super(`cannot send: ${phone} has no recorded consent to be texted`)
    this.name = "SmsNoConsentError"
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
 * FOUR CHECKS, failing on the first: suppression -> consent -> configuration
 * -> segment length. The two with legal consequences come first, and in that
 * order, deliberately: ordering configuration ahead of either would let an
 * unconfigured business mask a suppressed or non-consenting number behind a
 * different error that an admin then "fixes".
 *
 * SUPPRESSION IS AHEAD OF CONSENT, AND ONLY CONSENT IS OVERRIDABLE (G28).
 * `consentOverride` is the coach's "Send anyway" tick; it skips the consent
 * check and nothing else. A STOP is not a preference, so no tick reaches
 * past the suppression check above it.
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
 * THE ROW IS WRITTEN BEFORE THE SEND, as `queued`, and the outcome is
 * stamped onto it afterwards (`markSmsMessageOutcome`) — so a status
 * callback racing the send finds a row rather than answering
 * `unknown_message`. Read that function's doc comment for exactly how much
 * of the race that removes: the window narrows, it does not close, because
 * the sid only exists once Twilio has answered.
 *
 * NEITHER of the two DB writes is allowed to throw out of this function.
 * A failed QUEUED write must not silence a coach's reply (the send goes
 * ahead and the pre-existing insert-after path records it instead), and a
 * failed OUTCOME write comes after Twilio has already accepted the message,
 * so throwing would misreport a delivered text as unsent. Both are logged,
 * and `messageId` comes back `null` when no row could be written at all.
 */
export async function sendManualSms(args: {
  phone: string
  body: string
  settings: BusinessSettings
  businessId: string
  contactId?: string | null
  sentBy?: string | null
  appendOptOut: boolean
  /**
   * G28. `true` skips the consent check — the coach ticked "Send anyway".
   * REQUIRED, not optional-defaulting-to-false: a new call site that forgets
   * it should fail to compile rather than quietly inherit either policy.
   * It skips CONSENT ONLY; suppression is checked before it and is never
   * overridable.
   */
  consentOverride: boolean
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

  // 1. Suppression. FIRST, AND BEFORE THE OVERRIDE CAN APPLY — a STOP is
  // not a preference and "Send anyway" must never reach past it.
  if (await isSuppressed(phone, businessId)) {
    throw new SmsSuppressedError(phone)
  }

  // 2. Consent (G28). Second, ahead of configuration, for the same reason
  // suppression is ahead of it: a legal refusal must not be masked by a
  // credentials error, which an admin fixes and then texts someone who
  // never agreed.
  //
  // NO CONTACT MEANS NO CONSENT. `contactId` is optional on this function,
  // so without this branch the gate would be bypassed by texting a number
  // that has no contact row — which is the easiest thing in the world to
  // do from the compose box.
  if (!args.consentOverride) {
    if (!args.contactId) {
      throw new SmsNoConsentError(phone)
    }
    // `hasConsent` THROWS on a read failure rather than returning false,
    // deliberately (see its doc comment): "could not read" and "they said
    // no" are different answers. That throw is left to propagate — the
    // route maps it to the generic 502 "try again", which is the honest
    // answer for an unreadable row.
    if (!(await hasConsent(args.contactId, "sms"))) {
      throw new SmsNoConsentError(phone)
    }
  }

  // 3. Configuration. Throws SmsNotConfiguredError.
  assertSmsSendable(args.settings)

  // 4. Segment length.
  const { text } = renderManualSms({ body: args.body, appendOptOut: args.appendOptOut })
  const counted = countSmsSegments(text)
  if (counted.segments > MANUAL_SMS_MAX_SEGMENTS) {
    throw new SmsTooLongError(counted.segments, MANUAL_SMS_MAX_SEGMENTS)
  }

  // 4. The row, BEFORE the send, as `queued`.
  //
  // WHY THIS ORDER: the status callback (/api/webhooks/twilio/status) finds
  // its row by `twilio_sid`, and it can arrive within milliseconds of the
  // POST returning. Inserting after the send meant a fast callback found no
  // row at all and `updateSmsStatusBySid` answered `unknown_message` — the
  // carrier's own delivery report, dropped on the floor.
  //
  // BE HONEST ABOUT WHAT THIS FIXES: it does NOT close the race. The Twilio
  // sid does not exist until the POST RETURNS, so a callback that lands
  // between the response and the `markSmsMessageOutcome` UPDATE below still
  // resolves to `unknown_message`. What changes is the size of the window —
  // from "the whole Twilio POST latency plus an INSERT" down to "the
  // response landing, then one UPDATE". Narrower, not gone. Closing it
  // entirely would need an identity Twilio accepts BEFORE the send (a
  // client-generated key it echoes back), which the Messaging API does not
  // offer.
  //
  // A failure here is logged, never thrown: a DB blip must not silence a
  // coach's reply. `messageId` stays null and the pre-Task-7 insert-after
  // behaviour below takes over, so the conversation still gets its row.
  let messageId: string | null = null
  try {
    const queued = await insertSmsMessage({
      businessId,
      contactId: args.contactId ?? null,
      phone,
      direction: "outbound",
      body: text,
      status: "queued",
      sentBy: args.sentBy ?? null,
    })
    messageId = queued.id
  } catch (err) {
    console.error(`[lead-engine/sms] sendManualSms: could not write the queued row for ${phone}; sending anyway:`, err)
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
    // failed message, not a gap. This write has its OWN try/catch: `err` is
    // the real cause (Twilio refused the send), and if the DAL call itself
    // throws here (a DB fault on top of the provider fault), that second
    // error must not replace the first as what gets reported — the caller
    // needs to know the send failed and why, not that the failure record
    // also failed to write.
    const codeMatch = message.match(/\[(\d+)\]/)
    const errorCode = codeMatch ? codeMatch[1] : null
    try {
      if (messageId) {
        // The queued row is already there: stamp the outcome onto it. A
        // second insert would show the same text twice in the thread.
        await markSmsMessageOutcome(messageId, { kind: "failed", errorCode })
      } else {
        await insertSmsMessage({
          businessId,
          contactId: args.contactId ?? null,
          phone,
          direction: "outbound",
          body: text,
          status: "failed",
          errorCode,
          sentBy: args.sentBy ?? null,
        })
      }
    } catch (recordErr) {
      console.error(`[lead-engine/sms] sendManualSms: failed to record the failed-send row for ${phone}:`, recordErr)
    }
    throw err
  }

  // The send already succeeded at this point. A failure recording it must
  // not be reported as a failure to SEND — that would report a delivered
  // text as lost, the same gap-in-the-conversation failure mode the catch
  // block above exists to prevent on the other side.
  try {
    if (messageId) {
      await markSmsMessageOutcome(messageId, { kind: "sent", twilioSid: providerMessageId })
    } else {
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
    }
  } catch (err) {
    console.error(
      `[lead-engine/sms] sendManualSms: message to ${phone} sent (provider id ${providerMessageId}) but recording it failed:`,
      err,
    )
  }

  return { messageId, providerMessageId, text }
}
