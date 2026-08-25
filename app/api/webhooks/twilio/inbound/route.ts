import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase"
import { validateTwilioSignature } from "@/lib/lead-engine/twilio-signature"
import { appOrigin } from "@/lib/lead-engine/origin"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { normalisePhone } from "@/lib/lead-engine/identity"
import { findContactByIdentifiers } from "@/lib/db/contacts"
import { recordConsent, suppress, unsuppress } from "@/lib/db/contact-consents"
import { exitRunsForContact } from "@/lib/db/sequences"
import { getBusinessSettings } from "@/lib/db/businesses"
import { renderSequenceEmail, sendRenderedSequenceEmail } from "@/lib/lead-engine/email"

/**
 * Twilio's inbound webhook for SMS a lead sends TO this business's number —
 * the compliance half of the SMS channel (spec §5). Twilio POSTs here
 * form-encoded on every inbound message and retries any non-2xx response
 * forever, exactly like the status callback (app/api/webhooks/twilio/status/
 * route.ts, Task 4) this route mirrors the shape of: signature validation
 * before any body-derived work, 403 on a missing signing secret or a bad
 * signature having touched the database not at all, 200 for every handled
 * outcome (Twilio retry semantics), 500 only when something actually throws
 * (an infra fault, not a poison payload).
 *
 * Twilio Setup: Console -> Phone Numbers / Messaging Service -> the number
 * this business receives on -> "A Message Comes In" webhook URL, set to
 * this route's public URL.
 *
 * FOUR outcomes, by body content (trimmed, trailing punctuation stripped,
 * uppercased, exact match against a fixed keyword set — NOT a
 * substring/contains check: "STOP IT" is two words, not the keyword "STOP",
 * and correctly falls through to the anything-else path, while "Stop." and
 * "STOP!" DO match — over-suppressing is the correct failure direction on a
 * compliance surface. Carrier-level filtering on the bare keyword is
 * Twilio's own job; this route's job is the compliance RECORD of the act):
 *
 *   STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT
 *     Suppress the phone number (identifier-keyed, so this happens even
 *     when no contact record matches it — a suppression exists to block a
 *     FUTURE send to this number, which needs no contact row to mean
 *     something). When a contact DOES match: also record a `granted: false`
 *     consent row quoting the raw inbound body as evidence, exit every
 *     active sequence run for them, and write a `sms_stop_received`
 *     timeline event. When `From` fails to parse as a phone number at all
 *     (no contact possible either), the suppression above is written under
 *     the raw string as a defensive record, but that alone protects
 *     nobody — see the inline comment at the `!phone` branch — so an
 *     ops-alert email fires instead, asking a human to suppress the number
 *     by hand.
 *
 *   START / UNSTOP / YES
 *     The inverse: unsuppress the phone number (always), and when a contact
 *     matches, record a `granted: true` consent row and a
 *     `sms_start_received` timeline event. Never touches sequence runs —
 *     opting back in re-subscribes; it does not resume whatever sequence
 *     they'd exited out of.
 *
 *   HELP
 *     A `sms_help_received` timeline event only. The carrier-level
 *     auto-reply (the actual help text sent back) is Messaging Service
 *     configuration in the Twilio console, not code here (spec §5) —
 *     this route's whole job for HELP is the visibility record.
 *
 *   Anything else
 *     A `sms_inbound` timeline event (body capped at 500 chars in
 *     metadata — this is a length scrub, same rationale as
 *     lib/audit/scrub.ts's metadata cap elsewhere in this repo, not a
 *     content filter), plus an ops-alert email to the business's
 *     `reply_to` address so a human sees the reply. NO auto-reply to the
 *     SMS sender, ever, for any of these four outcomes — that is a
 *     carrier/Messaging-Service concern (HELP) or simply out of scope
 *     (everything else); this codebase does not originate a reply SMS from
 *     this route.
 *
 * All FOUR of the timeline-writing paths above are gated on a matched
 * contact, for the same structural reason as the STOP no-match case:
 * `contact_timeline_events.contact_id` and `contact_consents.contact_id`
 * are both NOT NULL (migrations 00214, 00215) — there is no row to attach
 * either write to when nobody in this business has this phone number on
 * file. Only `suppress`/`unsuppress` are identifier-keyed rather than
 * contact-keyed, which is exactly why they're the one write that still
 * happens on a STOP/START from an unknown number.
 */

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"])
const START_KEYWORDS = new Set(["START", "UNSTOP", "YES"])
const HELP_KEYWORDS = new Set(["HELP"])

/**
 * Empty TwiML — the ONLY body Twilio accepts on a handled inbound message.
 *
 * Twilio's messaging webhook parses the response as TwiML and rejects any
 * other content type outright with error 12300 ("Invalid Content-Type:
 * application/json supplied"). This route used to answer `NextResponse.json`
 * on all four success paths, so in production every STOP and START logged a
 * 12300 and Twilio discarded the response. The DB writes still happened —
 * 12300 is Twilio refusing our REPLY, not our processing failing — but any
 * future attempt to answer the sender through TwiML would have been silently
 * dropped, which on the opt-out surface is the expensive kind of broken.
 *
 * Twenty-seven tests covered this route and all of them passed, because every
 * one asserted `res.status` and the database side effects and not one asserted
 * the content type. The contract the tests pinned was not the contract Twilio
 * enforces.
 *
 * `<Response/>` is deliberately EMPTY: it means "received, nothing to say
 * back", which preserves this route's documented no-auto-reply rule (see the
 * doc comment above — spec §5 puts the HELP and STOP replies on Messaging
 * Service configuration, not here). Putting reply text in here instead would
 * move a compliance decision out of the console and into code silently.
 */
const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

/**
 * The handled-outcome response. The outcome string moves to a header rather
 * than a JSON body: Twilio ignores unknown headers, so this keeps the
 * which-branch-fired signal that the JSON body used to carry (in logs, and
 * for tests) without feeding Twilio a body it rejects.
 */
function handled(outcome: "stop" | "start" | "help" | "inbound", matched: boolean) {
  return new NextResponse(TWIML_EMPTY, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "X-Twilio-Inbound-Outcome": outcome,
      "X-Twilio-Inbound-Matched": String(matched),
    },
  })
}

const TIMELINE_SOURCE = "twilio_inbound_webhook"
const TIMELINE_BODY_CAP = 500

/**
 * A local, unexported timeline writer — same pattern as
 * lib/lead-engine/unsubscribe.ts's `recordUnsubscribeTimelineEvent` and
 * lib/automation/sequence-tick-runner.ts's own `writeTimelineEvent`. Not
 * shared code: each of those three call sites gives `contact_timeline_events
 * .source` a different, caller-identifying value ("unsubscribe_link",
 * "sequence_engine", and this route's own "twilio_inbound_webhook"), and a
 * single shared helper would either lose that distinction or have to thread
 * a `source` parameter through every call. Throws on failure rather than
 * logging-and-continuing, matching both precedents: a silently dropped
 * compliance record here is exactly the silence spec §5 exists to avoid.
 */
async function writeTimelineEvent(args: {
  contactId: string
  kind: string
  metadata: Record<string, unknown>
}): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.from("contact_timeline_events").insert({
    business_id: SINGLETON_BUSINESS_ID,
    contact_id: args.contactId,
    kind: args.kind,
    source: TIMELINE_SOURCE,
    metadata: args.metadata,
  })
  if (error) throw error
}

function capBody(body: string): string {
  return body.length > TIMELINE_BODY_CAP ? body.slice(0, TIMELINE_BODY_CAP) : body
}

/**
 * Quotes text an outsider wrote — the message body, the `From` field — into an
 * operator-alert email body WITHOUT it being read as a template.
 *
 * `renderSequenceEmail` treats its `body` as a template on purpose: that is how
 * a sequence step's stored copy gets `{{name}}` and `{{sms_consent_url}}`
 * filled in. Neither placeholder means anything in an operator alert. There is
 * no contact NAME (these render with `contactName: null`), and there is no
 * consent URL to supply: that link is signed for a CONTACT and belongs only in
 * mail sent TO them, never in an internal notification ABOUT them.
 *
 * Left alone, both misfire on quoted text. `{{name}}` would be substituted
 * away to "" — the operator reads a sentence with a hole in it. Worse,
 * `{{sms_consent_url}}` with no URL supplied makes the renderer THROW
 * (lib/lead-engine/email.ts), and migration 00226 mails that placeholder's
 * rendered link to real people, so getting the literal back — quoted,
 * forwarded, or retyped by someone asking "is this really you?" — is an
 * ordinary thing for a lead to do. That throw used to 500 this webhook, which
 * cost the operator the very alert the block exists to send and left Twilio
 * retrying a payload no retry could fix.
 *
 * The defang is minimal and deliberately visible: only the opening brace pair
 * is split, so the operator still reads essentially what arrived. The verbatim
 * bytes are on the timeline row either way — that is the record; this email is
 * the notification.
 */
function quoteForOperatorAlert(text: string): string {
  return text.replaceAll("{{", "{ {")
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    // Same rationale as the status callback: no signing secret means no way
    // to verify this request actually came from Twilio. Refuse before
    // reading the body or touching the database at all.
    return NextResponse.json({ error: "twilio not configured" }, { status: 403 })
  }

  // Read the body exactly once — a second .formData() call on the same
  // Request throws ("body stream already read").
  const form = await request.formData()
  const params: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value
  }

  const signature = request.headers.get("x-twilio-signature") ?? ""
  const pathname = new URL(request.url).pathname
  const url = `${appOrigin()}${pathname}`

  const valid = validateTwilioSignature({ url, params, signature, authToken })
  if (!valid) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 })
  }

  // Everything past this point is body-derived work, and every DB call
  // below is a genuine infra fault if it throws — unlike the status
  // callback's `applyDeliveryStatus`, nothing here has a "mapped, never
  // throws" outcome space to distinguish from a real fault, so the whole
  // block is one try/catch: any exception 500s (Twilio retries), and the
  // response body stays generic, never the underlying error.
  try {
    const rawBody = params.Body ?? ""
    const rawFrom = params.From ?? ""

    const phone = normalisePhone(rawFrom)
    // Suppression is identifier-keyed, not contact-keyed, so it needs SOME
    // identifier even on the rare inbound message whose `From` fails E.164
    // parsing. A normalised phone is preferred (it's what every send-path
    // suppression check normalises to before comparing); the raw trimmed
    // value is the fallback of last resort, never silently dropped.
    const identifier = phone ?? rawFrom.trim()
    const contactId = phone ? await findContactByIdentifiers({ phone }) : null

    const trimmed = rawBody.trim()
    // Trailing punctuation ("Stop.", "STOP!") must still count as the
    // keyword: over-suppressing is the correct failure direction on a
    // compliance surface — the cost of a false positive here (an unrelated
    // message that happens to end in "stop.") is far lower than the cost of
    // a false negative (an ignored opt-out). Only TRAILING punctuation is
    // stripped, and only after trim: "STOP IT" has no trailing punctuation
    // to strip and still correctly falls through to anything-else — extra
    // WORDS are not forgiven, only trailing punctuation is. The keyword
    // match stays exact against this stripped/uppercased form; `rawBody`
    // (untouched) is still what gets quoted as consent evidence and stored
    // in timeline metadata below.
    const withoutTrailingPunctuation = trimmed.replace(/[.,!?]+$/, "")
    const upper = withoutTrailingPunctuation.toUpperCase()

    if (STOP_KEYWORDS.has(upper)) {
      await suppress(identifier, "sms_stop")
      if (contactId) {
        await recordConsent({
          contactId,
          channel: "sms",
          granted: false,
          source: "sms_inbound",
          wordingShown: rawBody,
        })
        await exitRunsForContact(contactId, "sms_stop")
        await writeTimelineEvent({
          contactId,
          kind: "sms_stop_received",
          metadata: { body: capBody(rawBody), from: rawFrom },
        })
      } else if (!phone) {
        // The suppression above is a defensive record only — it's keyed on
        // the RAW, un-normalised `From`, but every SEND path checks
        // `isSuppressed` against the contact's `phone_e164`, a NORMALISED
        // identifier (lib/automation/sequence-tick-runner.ts). A
        // suppression stored under a string that failed E.164 parsing will
        // never match what a future send looks up, so on its own it
        // protects nobody while looking compliant. There is also no
        // contact to attach a timeline row to (contact_id is NOT NULL).
        // The only way left to make this failure VISIBLE — instead of a
        // silently self-congratulatory 200 — is the same ops-alert
        // mechanism the anything-else path uses below: put it in front of a
        // human so this number gets suppressed by hand. Its own try/catch:
        // a failed alert here must not turn an already-degraded STOP into a
        // 500, and this webhook's 200 to Twilio must not depend on Resend.
        try {
          const settings = await getBusinessSettings()
          const rendered = renderSequenceEmail({
            settings,
            subject: "SMS STOP needs manual review",
            body: quoteForOperatorAlert(
              `An SMS STOP request could not be automatically honored because the sender's number could not be parsed as a phone number.\n\nFrom: ${rawFrom}`,
            ),
            contactName: null,
            includeUnsubscribeFooter: false,
          })
          await sendRenderedSequenceEmail({
            to: settings.reply_to,
            rendered,
            settings,
            includeUnsubscribeFooter: false,
          })
        } catch (err) {
          console.error("[twilio-inbound-webhook] STOP manual-review alert failed:", err)
        }
      }
      return handled("stop", Boolean(contactId))
    }

    if (START_KEYWORDS.has(upper)) {
      await unsuppress(identifier)
      if (contactId) {
        await recordConsent({
          contactId,
          channel: "sms",
          granted: true,
          source: "sms_inbound",
          wordingShown: rawBody,
        })
        await writeTimelineEvent({
          contactId,
          kind: "sms_start_received",
          metadata: { body: capBody(rawBody), from: rawFrom },
        })
      }
      return handled("start", Boolean(contactId))
    }

    if (HELP_KEYWORDS.has(upper)) {
      if (contactId) {
        await writeTimelineEvent({
          contactId,
          kind: "sms_help_received",
          metadata: { body: capBody(rawBody), from: rawFrom },
        })
      }
      return handled("help", Boolean(contactId))
    }

    // Anything else: visible-not-silent timeline row, plus an ops-alert
    // email so a human sees the reply. Both are gated on a matched contact
    // — see the doc comment above for why.
    if (contactId) {
      await writeTimelineEvent({
        contactId,
        kind: "sms_inbound",
        metadata: { body: capBody(rawBody), from: rawFrom },
      })

      // The alert-step pattern (lib/automation/sequence-tick-runner.ts,
      // `case "alert"`): render once, send to `settings.reply_to`, with
      // `includeUnsubscribeFooter: false`. That flag is not cosmetic here
      // either — this mail goes to the OPERATOR about a LEAD's reply, and
      // giving an internal notification an unsubscribe link/header risks a
      // corporate mail scanner in the operator's own inbox GETting it and
      // silently suppressing the lead it was reporting on. A failed alert
      // EMAIL is logged, not fatal: the timeline row above already
      // satisfies "visible", and this webhook's 200 to Twilio must not
      // depend on a Resend hiccup for a side-channel notification to
      // someone else.
      //
      // The RENDER is inside that try as well, and has to be. It is handed a
      // body built out of a lead's own words, and `renderSequenceEmail` throws
      // on some of them (see `quoteForOperatorAlert`). Defanging stops the one
      // throw we know about; keeping the render inside the catch is what stops
      // the next one from turning a poison text message into a 500 and an
      // endless Twilio retry. `getBusinessSettings` stays OUTSIDE: a settings
      // read that fails is an infra fault, and a 500 there is the correct,
      // retryable answer.
      const settings = await getBusinessSettings()
      try {
        const rendered = renderSequenceEmail({
          settings,
          subject: "New SMS reply",
          body: quoteForOperatorAlert(`From: ${rawFrom}\n\n${rawBody}`),
          contactName: null,
          includeUnsubscribeFooter: false,
        })
        await sendRenderedSequenceEmail({
          to: settings.reply_to,
          rendered,
          settings,
          includeUnsubscribeFooter: false,
        })
      } catch (err) {
        console.error("[twilio-inbound-webhook] ops-alert email failed:", err)
      }
    }
    return handled("inbound", Boolean(contactId))
  } catch (err) {
    console.error("[twilio-inbound-webhook] processing failed:", err)
    return NextResponse.json({ error: "internal" }, { status: 500 })
  }
}
