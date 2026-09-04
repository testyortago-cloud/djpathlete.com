import { NextResponse } from "next/server"
import { z } from "zod"

import { type CalendlyTenant, resolveCalendlyTenant } from "@/lib/bookings/calendly-tenant"
import { recordAudit } from "@/lib/audit/record"
import { ingestBooking } from "@/lib/bookings/ingest"
import { readCalendlySigningKey } from "@/lib/calendly/env"
import { CALENDLY_SIGNATURE_HEADER, verifyCalendlySignature } from "@/lib/calendly/signature"
import { decodeTracking } from "@/lib/calendly/tracking"
import { normalisePhone } from "@/lib/lead-engine/identity"

/**
 * Webhook endpoint for Calendly — `invitee.created` and `invitee.canceled`.
 *
 * AN ADAPTER, like app/api/webhooks/ghl-booking/route.ts. It verifies the
 * signature, translates Calendly's payload into `BookingIngestInput`, and calls
 * `ingestBooking`. What a booking MEANS — the row, the sequence exit, the ads
 * conversion, the pipeline card — is decided there, once, for both sources.
 *
 * THE ORDER OF THE FIRST THREE LINES IS THE SECURITY MODEL.
 *   1. No signing key configured → 403 before the body is read. A missing
 *      secret must look exactly like a forged request, not like an open door.
 *   2. `request.text()` BEFORE any JSON parsing. The signature covers the raw
 *      bytes; a re-serialised body is not the signed body.
 *   3. Bad or stale signature → 403, nothing read from or written to the
 *      database.
 *
 * Calendly signs `t.<raw body>` with HMAC-SHA256 and does NOT sign the URL, so
 * the apex-vs-www trap that broke the Twilio webhooks here cannot recur; the
 * trap that CAN is reading the body twice or through `.json()` first.
 *
 * A RESCHEDULE IS TWO DELIVERIES (spec §8.2): `invitee.canceled` for the old
 * invitee with `rescheduled: true`, `invitee.created` for the new one under a
 * NEW scheduled_event URI, in no guaranteed order. The cancel half is passed
 * to the ingest with `rescheduled: true`, which marks the row cancelled but
 * keeps it away from the pipeline and the sequences — otherwise a person who
 * moved their call by a day gets a Lost card.
 *
 * WHOSE BOOKING IS THIS? The delivery carries no session, so the only tenant
 * evidence it holds is the event type it was booked against.
 * `resolveCalendlyTenant` matches that against
 * `coach_calendar_connections.event_type_uri` and hands back the claiming
 * row's business, host and connection id. An event type no row claims, but
 * which equals CALENDLY_EVENT_TYPE_URI, takes the platform ramp instead — the
 * single-coach install this phase grew out of, kept working across the window
 * between a migration reaching production and the owner clicking Connect.
 *
 * Anything matching NEITHER is acknowledged with a 200 and ingested nowhere.
 * An event type we do not recognise is somebody else's business, not an
 * error, and Calendly disables a subscription after 24 hours of failed
 * deliveries — a disabled subscription has to be recreated by hand. A
 * delivery carrying no event type at all is ignored on the same grounds: it
 * cannot be proven to belong to anyone.
 *
 * A read that FAILED is not "no match", and conflating them files a real
 * booking under the wrong coach. The lookup throws rather than answering
 * null, and this route turns that throw into a 500 so Calendly retries.
 *
 * Setup: scripts/calendly-setup.mjs registers the platform's own subscription
 * (`POST /webhook_subscriptions` with our signing key) once the CALENDLY_*
 * values are in place; a coach connecting their own calendar registers a
 * subscription of their own when they pick an event type.
 */

const CONFIGURED_AWAY = { error: "calendly not configured" }

const trackingSchema = z
  .object({
    utm_campaign: z.string().nullable().optional(),
    utm_source: z.string().nullable().optional(),
    utm_medium: z.string().nullable().optional(),
    utm_content: z.string().nullable().optional(),
    utm_term: z.string().nullable().optional(),
    salesforce_uuid: z.string().nullable().optional(),
  })
  .loose()

const scheduledEventSchema = z
  .object({
    uri: z.string().url(),
    name: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    start_time: z.string().min(1),
    end_time: z.string().min(1).nullable().optional(),
    event_type: z.string().url().nullable().optional(),
    location: z
      .object({ type: z.string().nullable().optional(), location: z.string().nullable().optional() })
      .loose()
      .nullable()
      .optional(),
  })
  .loose()

const inviteeSchema = z
  .object({
    uri: z.string().url(),
    email: z.string().email(),
    name: z.string().nullable().optional(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    timezone: z.string().nullable().optional(),
    text_reminder_number: z.string().nullable().optional(),
    cancel_url: z.string().url().nullable().optional(),
    reschedule_url: z.string().url().nullable().optional(),
    rescheduled: z.boolean().nullable().optional(),
    old_invitee: z.string().nullable().optional(),
    new_invitee: z.string().nullable().optional(),
    tracking: trackingSchema.nullable().optional(),
    cancellation: z
      .object({ canceled_by: z.string().nullable().optional(), reason: z.string().nullable().optional() })
      .loose()
      .nullable()
      .optional(),
    scheduled_event: scheduledEventSchema,
  })
  .loose()

const envelopeSchema = z
  .object({
    event: z.string(),
    created_at: z.string().optional(),
    created_by: z.string().optional(),
    payload: z.unknown(),
  })
  .loose()

const HANDLED_EVENTS = new Set(["invitee.created", "invitee.canceled"])

function durationMinutes(start: string, end: string | null | undefined): number {
  if (!end) return 30
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 30
  return Math.round(ms / 60_000)
}

/**
 * The phone Calendly knows. A phone-call event puts the invitee's number in
 * `location.location`; an SMS-reminder opt-in puts it in `text_reminder_number`.
 * Normalised to E.164 so it matches `contacts.phone_e164` the way the identity
 * helpers expect (bookings from GHL are national-format; readers normalise both
 * sides, so either spelling is safe to store).
 */
function inviteePhone(invitee: z.infer<typeof inviteeSchema>): string | null {
  const location = invitee.scheduled_event.location
  const fromCall = location?.type === "outbound_call" ? location.location : null
  const raw = fromCall ?? invitee.text_reminder_number ?? null
  return raw ? (normalisePhone(raw) ?? raw) : null
}

function inviteeName(invitee: z.infer<typeof inviteeSchema>): string {
  const full = invitee.name?.trim()
  if (full) return full
  const joined = [invitee.first_name, invitee.last_name].filter(Boolean).join(" ").trim()
  return joined || "Unknown"
}

export async function POST(request: Request) {
  const signingKey = readCalendlySigningKey()
  if (!signingKey) {
    return NextResponse.json(CONFIGURED_AWAY, { status: 403 })
  }

  // Raw bytes FIRST. This is the only read of the body in the handler.
  const rawBody = await request.text()
  const verdict = verifyCalendlySignature({
    header: request.headers.get(CALENDLY_SIGNATURE_HEADER),
    rawBody,
    signingKey,
  })
  if (!verdict.ok) {
    return NextResponse.json({ error: `invalid signature (${verdict.reason})` }, { status: 403 })
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "body is not JSON" }, { status: 400 })
  }

  const envelope = envelopeSchema.safeParse(json)
  if (!envelope.success) {
    return NextResponse.json({ error: "unrecognised envelope" }, { status: 400 })
  }

  // Anything we did not subscribe to, or a future event name, is acknowledged
  // so Calendly stops retrying it — and logged, because a 200 nobody can see
  // is how an event type silently goes unhandled.
  if (!HANDLED_EVENTS.has(envelope.data.event)) {
    console.warn(`[calendly-webhook] ignoring event ${envelope.data.event}`)
    return NextResponse.json({ ignored: true, event: envelope.data.event }, { status: 200 })
  }

  const invitee = inviteeSchema.safeParse(envelope.data.payload)
  if (!invitee.success) {
    console.error("[calendly-webhook] payload did not match the invitee shape", invitee.error.flatten())
    return NextResponse.json({ error: "unrecognised payload", details: invitee.error.flatten().fieldErrors }, { status: 400 })
  }
  const data = invitee.data

  // WHOSE booking is this — the connection row claiming this event type, or
  // the platform's own tenant on the ramp. lib/bookings/calendly-tenant.ts
  // owns that decision; this route owns only what to answer.
  let tenant: CalendlyTenant
  try {
    tenant = await resolveCalendlyTenant(data.scheduled_event.event_type)
  } catch (err) {
    // The lookup could not be PERFORMED, which is not the same answer as "no
    // connection matched". Swallowing it here would take the ramp and file
    // this coach's booking into the platform's tenant, silently and with a
    // 200. A 500 instead, which Calendly retries.
    console.error("[calendly-webhook] could not resolve this delivery's tenant:", err)
    // A console line nobody reads is not an alert. This lands in audit_logs as
    // a FAILURE, which the 24h strip on /admin/audit-logs already surfaces --
    // and 24 hours is exactly the budget, because that is how long Calendly
    // tolerates failed deliveries before disabling the subscription outright.
    // Fire-and-forget by design: an audit write must never be the reason a
    // retryable 500 becomes something else.
    void recordAudit({
      action: "booking.tenant_unresolved",
      category: "automation",
      outcome: "failure",
      actor: { role: "system", email: "calendly" },
      metadata: {
        event_type: data.scheduled_event.event_type ?? null,
        calendly_event_uri: data.scheduled_event.uri,
        reason: err instanceof Error ? err.message : String(err),
      },
    })
    return NextResponse.json({ error: "could not resolve the booking's tenant" }, { status: 500 })
  }

  // Not ours, and NEVER a 5xx: an event type nobody here claims belongs to
  // somebody else, and 24 hours of failed deliveries disables the
  // subscription. FAILS CLOSED — a delivery with no event type at all
  // resolves to `unknown` too, and lands here.
  if (tenant.kind === "unknown") {
    console.warn(`[calendly-webhook] ignoring event type ${data.scheduled_event.event_type ?? "(none)"}`)
    return NextResponse.json({ ignored: true, event_type: data.scheduled_event.event_type ?? null }, { status: 200 })
  }

  const cancelled = envelope.data.event === "invitee.canceled"
  const rescheduled = cancelled && data.rescheduled === true
  const tracking = decodeTracking(data.tracking)

  const notes = rescheduled
    ? `Rescheduled via Calendly${data.new_invitee ? ` → ${data.new_invitee}` : ""}`
    : cancelled
      ? [`Cancelled via Calendly`, data.cancellation?.reason ? `Reason: ${data.cancellation.reason}` : null]
          .filter(Boolean)
          .join(". ")
      : data.old_invitee
        ? `Rescheduled via Calendly from ${data.old_invitee}`
        : null

  try {
    const outcome = await ingestBooking({
      source: "calendly",
      businessId: tenant.businessId,
      hostId: tenant.hostId,
      connectionId: tenant.kind === "connection" ? tenant.connectionId : null,
      // Both of these are already parsed on this route and then thrown away:
      // the conversation id reaches only the audit row's metadata, and the
      // invitee timezone is validated at :81 and dropped. They have columns now.
      chatConversationId: tracking.conversationId ?? null,
      inviteeTimezone: data.timezone ?? null,
      key: { column: "calendly_event_uri", value: data.scheduled_event.uri },
      contact: { name: inviteeName(data), email: data.email, phone: inviteePhone(data) },
      bookingDate: data.scheduled_event.start_time,
      durationMinutes: durationMinutes(data.scheduled_event.start_time, data.scheduled_event.end_time),
      status: cancelled ? "cancelled" : "scheduled",
      notes,
      clickIds: { gclid: tracking.gclid, gbraid: tracking.gbraid, wbraid: tracking.wbraid, fbclid: tracking.fbclid },
      columns: {
        calendly_event_uri: data.scheduled_event.uri,
        reschedule_url: data.reschedule_url ?? null,
        cancel_url: data.cancel_url ?? null,
      },
      rescheduled,
      // The create half of a reschedule names the invitee it replaces; the
      // ingest then skips the conversion and the notification (already counted
      // when first booked) and audits it as a reschedule.
      rescheduledFrom: cancelled ? null : (data.old_invitee ?? null),
      // invitee.created is an immutable "it happened" event. If the row is
      // already cancelled, this is a retry of a delivery that timed out, and
      // must not reopen the card.
      ignoreIfTerminal: !cancelled,
      actor: "calendly",
      auditSource: "calendly_webhook",
      auditMetadata: {
        calendly_event_uri: data.scheduled_event.uri,
        calendly_invitee_uri: data.uri,
        calendly_event: envelope.data.event,
        chat_conversation_id: tracking.conversationId,
        rescheduled,
      },
      request,
    })

    return NextResponse.json(
      { success: true, action: outcome.action },
      { status: outcome.action === "created" ? 201 : 200 },
    )
  } catch (err) {
    console.error("[calendly-webhook] Error:", err)
    return NextResponse.json({ error: "Failed to process booking webhook" }, { status: 500 })
  }
}
