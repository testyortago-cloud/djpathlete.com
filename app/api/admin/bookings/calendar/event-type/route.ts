// app/api/admin/bookings/calendar/event-type/route.ts
//
// GET  — the coach's active Calendly meetings, so they can pick the consult.
// POST — pick one, and take ownership of the webhook that delivers its
//        bookings.
//
// THE POSTED EVENT TYPE IS CHECKED AGAINST THE COACH'S OWN ACCOUNT BEFORE IT
// IS CLAIMED, and that check is load-bearing, not tidiness. `event_type_uri`
// is UNIQUE across every connection (migration 00240) and it is the webhook's
// entire tenant proof: whoever owns the row owns every booking made against
// that event type. Take the URI on trust and a coach could name a URI from
// another coach's Calendly, claim it, and start receiving that coach's
// bookings — a cross-tenant read, delivered silently with a 200. So the list
// comes from Calendly, keyed on the connection's OWN user URI, and the choice
// must be in it.
//
// CLAIM FIRST, THEN REGISTER. The uniqueness conflict has to surface before a
// subscription exists in the coach's Calendly account, or a rejected pick
// leaves behind a subscription we hold no handle to and can never delete.
//
// WHICH MAKES EVERY OTHER CHECK COME BEFORE THE CLAIM, and a failed
// registration give it back. Between the claim and a stored
// `webhook_subscription_uri` the row reads as a finished connection, so any
// exit in that window ships the coach a green "Connected" badge on a calendar
// that will never receive a booking.
//
// AND ONLY REGISTER ONCE. A Calendly subscription is scoped to the USER, not
// to one event type, so a coach changing which meeting is the consult still
// has a working subscription. Registering a second one would double every
// delivery.

import { NextResponse } from "next/server"
import { z } from "zod"

import { withAudit } from "@/lib/audit/with-audit"
import { CalendlyPlanRequiredError, createWebhookSubscription, listEventTypes } from "@/lib/calendly/account"
import { calendlyWebhookCallbackUrl } from "@/lib/calendly/connect-env"
import { accessTokenForConnection } from "@/lib/calendly/credentials"
import { readCalendlySigningKey } from "@/lib/calendly/env"
import {
  clearCoachCalendarEventType,
  setCoachCalendarError,
  updateCoachCalendarEventType,
} from "@/lib/db/coach-calendar-connections"
import { requireCalendarConnection } from "../connection"

/** Spec §6.2's sentence, verbatim. A coach can act on this one; "something went wrong" they cannot. */
const PLAN_REQUIRED_MESSAGE =
  "Calendly only sends us bookings on a paid plan (Standard, Teams or Enterprise). Upgrade in Calendly, then pick your meeting again."

const ALREADY_CLAIMED_MESSAGE = "That meeting is already connected to another coach's calendar."

const selectSchema = z.object({ eventTypeUri: z.string().min(1) })

/**
 * `lib/db/coach-calendar-connections.ts` flattens a PostgREST error into
 * `"<fn> failed (<code>): <message>"`, so the code and the constraint name are
 * only available as text. Both are required: a 23505 on some other constraint
 * is a different bug and must not be reported to the coach as "someone else
 * has this meeting".
 */
function isEventTypeAlreadyClaimed(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes("(23505)") && message.includes("coach_calendar_connections_event_type_key")
}

export async function GET(request: Request) {
  const ctx = await requireCalendarConnection(request)
  if ("response" in ctx) return ctx.response

  const { connection } = ctx
  if (!connection.calendly_user_uri) {
    return NextResponse.json({ error: "Connect your Calendly account again — we lost track of it." }, { status: 409 })
  }

  try {
    const accessToken = await accessTokenForConnection(connection)
    const eventTypes = await listEventTypes({ accessToken, userUri: connection.calendly_user_uri })
    return NextResponse.json({ eventTypes })
  } catch (err) {
    console.error("[calendar/event-type] listing event types failed", err)
    return NextResponse.json({ error: "We could not reach Calendly just now. Try again in a moment." }, { status: 502 })
  }
}

export const POST = withAudit({ action: "calendar.event_type_selected", category: "admin_write" }, async (request) => {
  const ctx = await requireCalendarConnection(request)
  if ("response" in ctx) return ctx.response

  const { connection } = ctx
  if (!connection.calendly_user_uri) {
    return NextResponse.json({ error: "Connect your Calendly account again — we lost track of it." }, { status: 409 })
  }

  const parsed = selectSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick one of your Calendly meetings." }, { status: 400 })
  }

  let accessToken: string
  let chosen: { uri: string; name: string; schedulingUrl: string } | undefined
  try {
    accessToken = await accessTokenForConnection(connection)
    const eventTypes = await listEventTypes({ accessToken, userUri: connection.calendly_user_uri })
    chosen = eventTypes.find((t) => t.uri === parsed.data.eventTypeUri)
  } catch (err) {
    console.error("[calendar/event-type] could not confirm the chosen meeting", err)
    return NextResponse.json({ error: "We could not reach Calendly just now. Try again in a moment." }, { status: 502 })
  }

  if (!chosen) {
    return NextResponse.json({ error: "That meeting is not on your Calendly account." }, { status: 400 })
  }

  // Already subscribed: this is a change of mind about WHICH meeting is the
  // consult, not a new connection. One write, and the existing subscription
  // is carried across untouched.
  const existingSubscription = connection.webhook_subscription_uri
  if (existingSubscription) {
    try {
      await updateCoachCalendarEventType({
        connectionId: connection.id,
        eventTypeUri: chosen.uri,
        schedulingUrl: chosen.schedulingUrl,
        webhookSubscriptionUri: existingSubscription,
        webhookState: connection.webhook_state,
      })
    } catch (err) {
      if (isEventTypeAlreadyClaimed(err)) {
        return NextResponse.json({ error: ALREADY_CLAIMED_MESSAGE }, { status: 409 })
      }
      throw err
    }
    return NextResponse.json({ ok: true, eventTypeUri: chosen.uri, schedulingUrl: chosen.schedulingUrl })
  }

  // EVERY PRECONDITION FOR REGISTERING THE SUBSCRIPTION IS CHECKED BEFORE
  // ANYTHING IS CLAIMED. The claim has to precede the Calendly call (see the
  // header), so a check that ran after it would exit having left the row
  // `connected`, with a meeting chosen and no subscription — which the screen
  // renders as a finished, working calendar whose only button is Disconnect.
  // The coach sees a green tick on a calendar that can never receive a
  // booking. Production has no CALENDLY_WEBHOOK_SIGNING_KEY today, so that is
  // the path the very first pick after go-live would take, not a corner case.
  const callbackUrl = calendlyWebhookCallbackUrl()
  const signingKey = readCalendlySigningKey()
  if (!callbackUrl || !signingKey) {
    console.error("[calendar/event-type] NEXTAUTH_URL or CALENDLY_WEBHOOK_SIGNING_KEY is not configured")
    return NextResponse.json({ error: "Receiving bookings is not configured on this server yet." }, { status: 500 })
  }

  // Calendly requires the organization URI on every subscription request.
  // Sending "" would be rejected with a shape error that reads like an
  // outage, so an absent one is named as what it is: a connection to redo.
  if (!connection.calendly_organization_uri) {
    return NextResponse.json(
      { error: "Connect your Calendly account again — we did not record which organisation it belongs to." },
      { status: 409 },
    )
  }

  // Claim the event type before anything exists in Calendly to clean up.
  try {
    await updateCoachCalendarEventType({
      connectionId: connection.id,
      eventTypeUri: chosen.uri,
      schedulingUrl: chosen.schedulingUrl,
      webhookSubscriptionUri: null,
      webhookState: null,
    })
  } catch (err) {
    if (isEventTypeAlreadyClaimed(err)) {
      return NextResponse.json({ error: ALREADY_CLAIMED_MESSAGE }, { status: 409 })
    }
    throw err
  }

  let subscription: { uri: string; state: string }
  try {
    subscription = await createWebhookSubscription({
      accessToken,
      organizationUri: connection.calendly_organization_uri,
      userUri: connection.calendly_user_uri,
      callbackUrl,
      signingKey,
    })
  } catch (err) {
    if (err instanceof CalendlyPlanRequiredError) {
      // The one 403 Calendly's docs let us attribute. `plan_lapsed` exists
      // in 00240's CHECK constraint for exactly this, and the screen turns
      // it into a sentence the coach can act on.
      await setCoachCalendarError(connection.id, "plan_lapsed", err.message).catch((writeErr) => {
        console.error("[calendar/event-type] could not record plan_lapsed", writeErr)
      })
      //
      // AND THE CLAIM IS KEPT HERE, unlike the transient branch below. The
      // screen's plan_lapsed card shows the picker with this meeting already
      // selected, so a coach who upgrades and picks again does not have to
      // remember which one they chose.
      return NextResponse.json({ error: PLAN_REQUIRED_MESSAGE, status: "plan_lapsed" }, { status: 402 })
    }
    console.error("[calendar/event-type] registering the webhook subscription failed", err)
    // GIVE THE CLAIM BACK. Nothing exists in Calendly (that is what just
    // failed) and nothing else releases `event_type_uri`, so keeping it would
    // strand the coach on a card that says Connected, offers only Disconnect,
    // and will never receive a booking. Clearing it returns them to the picker,
    // where the toast this 502 raises tells them to try again.
    await clearCoachCalendarEventType(connection.id).catch((clearErr) => {
      console.error(
        `[calendar/event-type] could not release the event type claim on connection ${connection.id} after a failed registration — the coach is stranded on "connected" with no subscription`,
        clearErr,
      )
    })
    return NextResponse.json(
      { error: "Calendly would not set up booking notifications just now. Try again in a moment." },
      { status: 502 },
    )
  }

  try {
    await updateCoachCalendarEventType({
      connectionId: connection.id,
      eventTypeUri: chosen.uri,
      schedulingUrl: chosen.schedulingUrl,
      webhookSubscriptionUri: subscription.uri,
      webhookState: subscription.state,
    })
  } catch (err) {
    // The subscription exists in Calendly but we failed to record its uri, so
    // Disconnect will never find it to delete. Naming the uri here is the only
    // thing that makes it recoverable by hand; rethrow after, because the
    // coach's pick genuinely did not complete.
    console.error(
      `[calendar/event-type] subscription ${subscription.uri} was created but not stored on connection ${connection.id} — remove it in Calendly or retry`,
      err,
    )
    throw err
  }

  // A coach who upgraded their Calendly plan and picked again must not stay
  // on `plan_lapsed` — the connection demonstrably works now.
  await setCoachCalendarError(connection.id, "connected", "").catch((err) => {
    console.error("[calendar/event-type] could not clear the connection status", err)
  })

  return NextResponse.json({
    ok: true,
    eventTypeUri: chosen.uri,
    schedulingUrl: chosen.schedulingUrl,
    webhookSubscriptionUri: subscription.uri,
    webhookState: subscription.state,
  })
})
