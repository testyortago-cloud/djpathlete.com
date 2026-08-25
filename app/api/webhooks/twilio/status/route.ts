import { NextResponse } from "next/server"
import { validateTwilioSignature } from "@/lib/lead-engine/twilio-signature"
import { applyDeliveryStatus } from "@/lib/db/sequences"
import { appOrigin } from "@/lib/lead-engine/origin"

/**
 * Twilio's status callback for outbound sequence SMS. This is the URL
 * `sendRenderedSequenceSms` (lib/lead-engine/sms.ts) hands Twilio as
 * `StatusCallback` on every send, via
 * `${appOrigin()}/api/webhooks/twilio/status`
 * (lib/automation/sequence-tick-runner.ts). Twilio POSTs to it form-encoded,
 * once per lifecycle transition (queued -> sent -> delivered/undelivered, or
 * -> failed), and retries any non-2xx response forever.
 *
 * Twilio Setup: Console -> Phone Numbers / Messaging Service -> the number
 * or messaging service this business sends from -> set the "Status Callback
 * URL" to this route's public URL. (In this codebase that URL is also set
 * programmatically per-message, per send — see the doc comment above — so no
 * console configuration is strictly required, but Twilio does require SOME
 * status callback URL configured or supplied per-message for these
 * callbacks to fire at all.)
 *
 * SECURITY: every request is verified against Twilio's `X-Twilio-Signature`
 * header (lib/lead-engine/twilio-signature.ts) before anything is read from
 * or written to the database. Missing `TWILIO_AUTH_TOKEN` or a bad signature
 * both answer 403 having touched the database not at all.
 *
 * RESPONSE CODE: a request with a VALID signature answers 200 for any of
 * `applyDeliveryStatus`'s three MAPPED outcomes — `updated`, `ignored`, or
 * `unknown_message` — even when the callback itself is meaningless (an
 * unrecognized sid) or a no-op (a status this app doesn't track, or a
 * terminal row). None of those throw, by construction, so retrying them
 * would just get the exact same answer again; Twilio retries any non-2xx
 * response forever, so they must never 500. The actual outcome is carried
 * on the `X-Twilio-Status-Outcome` response HEADER for anyone who wants to
 * look, not in the status code and not in the body -- see TWIML_EMPTY.
 *
 * A THROWN exception out of `applyDeliveryStatus` is different: nothing in
 * its mapped path throws for a bad or unrecognized payload, so a throw here
 * is by construction an infra fault (a DB read/write failure), not a poison
 * callback. That case DOES answer 500 — on purpose, so Twilio's own
 * retry-with-backoff gets a chance to self-heal a transient fault, rather
 * than this delivery status being silently and permanently lost behind a
 * false 200. The response body in that case stays generic and never echoes
 * the underlying error.
 */
/**
 * Empty TwiML. Mirrors app/api/webhooks/twilio/inbound/route.ts -- see the
 * long rationale on that route's TWIML_EMPTY. Empty because a status callback
 * has nobody to reply to: it reports on a message this app already sent.
 */
const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    // No signing secret means no way to verify this request actually came
    // from Twilio. Refuse before reading the body or touching the database
    // at all, same as a bad signature below.
    return NextResponse.json({ error: "twilio not configured" }, { status: 403 })
  }

  // Read the body exactly once — a second .formData() call on the same
  // Request throws ("body stream already read"), and this route has no
  // reason to read it twice.
  const form = await request.formData()
  const params: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value
  }

  const signature = request.headers.get("x-twilio-signature") ?? ""
  // Twilio signs the exact public URL it POSTed to. That has to be THIS
  // app's own public origin — the same appOrigin() the runner used to mint
  // `statusCallbackUrl` in the first place (lib/automation/sequence-tick-
  // runner.ts) — not whatever host request.url happens to report, which can
  // differ from the public origin behind a proxy or load balancer.
  const pathname = new URL(request.url).pathname
  const url = `${appOrigin()}${pathname}`

  const valid = validateTwilioSignature({ url, params, signature, authToken })
  if (!valid) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 })
  }

  let outcome: "updated" | "ignored" | "unknown_message"
  try {
    outcome = await applyDeliveryStatus(params.MessageSid ?? "", params.MessageStatus ?? "")
  } catch (err) {
    // See the RESPONSE CODE doc comment above: a throw here is an infra
    // fault, not a poison callback, so unlike the three mapped outcomes
    // this DOES 500 — Twilio's retry-with-backoff gets a chance to
    // self-heal a transient DB blip instead of the delivery status being
    // silently lost forever behind a false 200. The body stays generic —
    // never `err.message` — so an infra failure detail never leaks through
    // a public, unauthenticated-by-us-beyond-signature webhook response.
    console.error("[twilio-status-webhook] applyDeliveryStatus failed:", err)
    return NextResponse.json({ error: "internal" }, { status: 500 })
  }

  // Empty TwiML, matching the inbound webhook. Twilio parses a webhook
  // response as TwiML and answers a JSON body with error 12300 ("Invalid
  // Content-Type: application/json supplied") -- which is exactly what this
  // route's twin was doing in production until 2026-08-25.
  //
  // HONESTY ABOUT THE EVIDENCE: unlike the inbound route, this one was NOT
  // observed producing a 12300. A delivered test message on 2026-08-25 fired
  // this callback and logged no alert, so Twilio appears to tolerate JSON on
  // a status callback where it rejects it on an inbound message. This change
  // is therefore consistency and future-proofing, not a fix for a measured
  // fault. TwiML is never WRONG for a Twilio webhook, so aligning the twins
  // costs nothing and removes a latent difference between two routes that
  // are meant to mirror each other.
  return new NextResponse(TWIML_EMPTY, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "X-Twilio-Status-Outcome": outcome,
    },
  })
}
