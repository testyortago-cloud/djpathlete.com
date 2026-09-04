// app/api/admin/bookings/calendar/disconnect/route.ts
//
// THE ORDER IS THE WHOLE DESIGN. The Calendly subscription goes first, the
// vault secret second, because deleting the subscription REQUIRES the
// credentials. Reverse them and a failure in between leaves a live
// subscription we can no longer authenticate against — Calendly keeps posting
// bookings at a connection that has nothing left to file them under, and only
// the coach, inside Calendly's own UI, can stop it.
//
// BUT THE PROPERTY IS "DON'T DESTROY CREDENTIALS WHILE A RETRY COULD STILL
// SUCCEED", AND THAT IS VACUOUS ONCE THEY PROVABLY CANNOT AUTHENTICATE. A
// grant Calendly has revoked will never delete anything, so stopping on it
// left a `needs_reconnect` coach unable to disconnect AT ALL — their button
// would 502 forever, with no way out of the state. The split is therefore on
// FAULT CLASS, not on a force flag:
//
//   * transient — no network, a 5xx, a 429 -> stop, keep everything, say so.
//     A retry here genuinely can succeed.
//   * dead grant — no stored credentials, a status of `needs_reconnect`, or a
//     4xx from Calendly -> skip the delete and finish the local disconnect.
//     The subscription is orphaned; the coach is told to remove it in
//     Calendly, and its uri goes to the log AND an audit row so it is
//     recoverable rather than merely lost.
//
// AN ORPHANED SUBSCRIPTION CANNOT CROSS TENANTS. `fn_disconnect_coach_calendar`
// nulls `event_type_uri` (migration 00250), so a later delivery from it
// matches no connection, `resolveCalendlyTenant` answers `unknown`, and the
// webhook 200-ignores it. The cost of an orphan is clutter in the coach's own
// Calendly account, never a misfiled booking.
//
// A 404 IS NOT A FAILURE EITHER. `deleteWebhookSubscription` treats
// already-gone as success (see its docstring): the desired end state is "that
// subscription does not exist", and it does not.

import { NextResponse } from "next/server"

import { recordAudit } from "@/lib/audit/record"
import { withAudit } from "@/lib/audit/with-audit"
import { CalendlyAccountError, deleteWebhookSubscription } from "@/lib/calendly/account"
import { CalendlyUnavailable } from "@/lib/calendly/client"
import { accessTokenForConnection } from "@/lib/calendly/credentials"
import { disconnectCoachCalendar } from "@/lib/db/coach-calendar-connections"
import { requireCalendarConnection } from "../connection"

/**
 * Could this same call plausibly work later? Only then is it worth refusing to
 * disconnect. `network` and a null status are unclassified transport faults; a
 * 429 or a 5xx is Calendly asking us to come back. Every other 4xx means these
 * credentials do not work and never will, which no retry fixes.
 *
 * An UNRECOGNISED error class counts as transient, deliberately: destroying
 * credentials over a fault we cannot even name is the worse of the two
 * mistakes, and it is the one the coach cannot undo.
 */
function couldSucceedLater(err: unknown): boolean {
  if (!(err instanceof CalendlyUnavailable) && !(err instanceof CalendlyAccountError)) return true
  if (err.reason === "network") return true
  if (err.status === null) return true
  return err.status === 429 || err.status >= 500
}

export const POST = withAudit({ action: "calendar.disconnected", category: "admin_write" }, async (request) => {
  const ctx = await requireCalendarConnection(request)
  if ("response" in ctx) return ctx.response

  const { connection, hostId } = ctx
  const subscriptionUri = connection.webhook_subscription_uri

  /** Set when the subscription is left behind in Calendly, so the answer can say so. */
  let orphanedSubscriptionUri: string | null = null

  if (subscriptionUri) {
    const credentials = connection.credentials as { access_token?: string; refresh_token?: string } | undefined
    const grantIsAlreadyDead =
      connection.status === "needs_reconnect" || !credentials?.access_token || !credentials?.refresh_token

    if (grantIsAlreadyDead) {
      // Nothing to try. Asking for a token here would only produce the same
      // refusal a moment later.
      orphanedSubscriptionUri = subscriptionUri
    } else {
      try {
        const accessToken = await accessTokenForConnection(connection)
        await deleteWebhookSubscription({ accessToken, subscriptionUri })
      } catch (err) {
        if (couldSucceedLater(err)) {
          console.error("[calendar/disconnect] could not remove the Calendly subscription", err)
          return NextResponse.json(
            {
              error:
                "We could not tell Calendly to stop sending bookings, so nothing was disconnected. Try again in a moment.",
            },
            { status: 502 },
          )
        }
        console.warn(
          `[calendar/disconnect] the Calendly grant for connection ${connection.id} can no longer authenticate; disconnecting anyway`,
          err,
        )
        orphanedSubscriptionUri = subscriptionUri
      }
    }
  }

  if (orphanedSubscriptionUri) {
    console.warn(
      `[calendar/disconnect] orphaned Calendly subscription ${orphanedSubscriptionUri} on connection ${connection.id} — the coach has to remove it in Calendly`,
    )
  }

  await disconnectCoachCalendar(hostId)

  // Inline, alongside withAudit's own row. The wrapper records THAT the
  // disconnect happened; this records the one fact a later investigation would
  // need and could not recover, because the row it lived on has just been
  // nulled.
  if (orphanedSubscriptionUri) {
    await recordAudit({
      action: "calendar.disconnected",
      category: "admin_write",
      target: { type: "coach_calendar_connection", id: connection.id },
      request,
      metadata: {
        orphaned_webhook_subscription_uri: orphanedSubscriptionUri,
        reason: "the Calendly grant could no longer authenticate",
      },
    }).catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    orphanedWebhookSubscriptionUri: orphanedSubscriptionUri,
    message: orphanedSubscriptionUri
      ? "Your calendar is disconnected here. Calendly would not let us switch its booking notifications off, so open Calendly and delete the webhook there too."
      : undefined,
  })
})
