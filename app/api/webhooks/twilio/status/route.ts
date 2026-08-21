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
 * RESPONSE CODE: a request with a VALID signature always answers 200, even
 * when the callback itself is meaningless (`unknown_message`) or a no-op
 * (`ignored`) — Twilio retries any non-2xx response forever, so a poison
 * callback (an unrecognized sid, a status this app doesn't track, a DB
 * hiccup) must never 500 or it retries endlessly for no benefit. The actual
 * outcome is carried in the response body for anyone who wants to look, not
 * in the status code.
 */
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
    // Same "never 500 a webhook Twilio retries forever" reasoning as the
    // response-code doc comment above, extended to an unexpected DB failure:
    // a transient Supabase error here must not turn into an infinite Twilio
    // retry loop for a callback that will just fail the same way again.
    console.error("[twilio-status-webhook] applyDeliveryStatus failed:", err)
    return NextResponse.json({ ok: false, error: "internal error, not retried" }, { status: 200 })
  }

  return NextResponse.json({ ok: true, outcome }, { status: 200 })
}
