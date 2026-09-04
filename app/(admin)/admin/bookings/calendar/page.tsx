// app/(admin)/admin/bookings/calendar/page.tsx — the screen a coach connects
// their own Calendly account from.
//
// WHY IT LIVES UNDER /admin/bookings. That prefix maps to the `schedule`
// permission (lib/permissions/registry.ts), which a coach holds. Each coach
// owns and pays for their own Calendly account, so a coach has to be able to
// connect one without an operator doing it for them; /admin/businesses is
// owner-only and would have made that impossible. The gate is the same one
// the five /api/admin/bookings/calendar routes share.
//
// THE CARD IS A CLIENT COMPONENT AND NEVER RECEIVES THE CONNECTION ROW.
// `fn_get_coach_calendar_connection` decrypts and returns `credentials`, and
// everything handed to a client component is serialised into the HTML the
// browser downloads. So this file copies the row into `CalendarConnectionView`
// field by field: adding a field to that view is then a deliberate act rather
// than the side effect of a spread.
//
// THREE CALENDLY READS HAPPEN HERE, AND ONLY FOR A WORKING CONNECTION THAT HAS
// CHOSEN ITS MEETING: who the connection belongs to, what that meeting is
// called, and whether Calendly is still delivering its bookings.
// The first two are not stored on the row — 00240 keeps URIs, not display
// names — and this screen is the only place either is needed, so there is
// nothing to cache them in. All are wrapped: Calendly being unreachable must
// downgrade one line of the card, never blank the page. The PICKER's list is
// fetched by the card from the route instead, because that half is interactive
// and a coach who just added a meeting in Calendly wants the fresh list.
//
// THE THIRD READ IS WHY THIS PHASE HAS NO REFRESH CRON. Spec §10 trades one
// away against "the screen checks the subscription when it renders" — this is
// that check. `webhook_state` is written once at creation, and Calendly
// disables a subscription after 24 hours of failed deliveries WITHOUT changing
// its uri, so the stored value is a snapshot of one moment. Rendering it as
// live status is how a card could say "Calendly tells us as soon as someone
// books" over a subscription that stopped delivering weeks ago. Re-reading
// here also gives `webhook_checked_at` the only writer it has.
import Link from "next/link"

import { CalendarConnectionCard, type CalendarFlash } from "@/components/admin/bookings/CalendarConnectionCard"
import { fetchIdentity, getWebhookSubscription, listEventTypes } from "@/lib/calendly/account"
import { accessTokenForConnection } from "@/lib/calendly/credentials"
import { getPrimaryBookingHostId } from "@/lib/db/booking-hosts"
import { getCoachCalendarConnection, recordCoachCalendarWebhookState } from "@/lib/db/coach-calendar-connections"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"

export const dynamic = "force-dynamic"
export const metadata = { title: "Calendar" }

type PageProps = {
  searchParams: Promise<{ calendar?: string; reason?: string }>
}

/**
 * What the coach reads after Calendly sends them back. The callback route owns
 * the `reason` values; anything unrecognised falls through to the generic
 * sentence rather than showing the raw word.
 */
function flashFor(calendar: string | undefined, reason: string | undefined): CalendarFlash | null {
  if (calendar === "connected") {
    return { tone: "success", message: "Your Calendly account is connected." }
  }
  if (calendar === "declined") {
    return {
      tone: "warning",
      message:
        'You did not finish connecting, so nothing has changed. Click "Connect Calendly" when you are ready to try again.',
    }
  }
  if (calendar !== "error") return null
  if (reason === "config") {
    return {
      tone: "warning",
      message:
        "Connecting Calendly is not set up on this site yet. Ask the person who set up your account to finish it.",
    }
  }
  if (reason === "state" || reason === "pkce") {
    return {
      tone: "warning",
      message:
        'We could not finish connecting safely, so we stopped. Nothing has changed. Click "Connect Calendly" to start again.',
    }
  }
  return {
    tone: "warning",
    message: "Calendly did not finish connecting, so nothing has changed. Try again in a moment.",
  }
}

/** "4 September 2026". Formatted here so the date cannot read differently in the browser. */
function formatDay(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}

export default async function BookingsCalendarPage({ searchParams }: PageProps) {
  const params = await searchParams
  const { businessId } = await resolveAdminTenant()
  const hostId = await getPrimaryBookingHostId(businessId)
  let connection = hostId ? await getCoachCalendarConnection(hostId) : null

  let account: { name: string; email: string } | null = null
  let meeting: { name: string; durationMinutes: number } | null = null
  let accountReadFailed = false
  /**
   * What the card shows on the "New bookings" line. Starts as the stored
   * snapshot and is replaced by what Calendly says below — a failed check must
   * leave the last known answer standing, never overwrite it with a guess.
   */
  let webhookState = connection?.webhook_state ?? null

  const chosen = connection
  // `connected` and `error` ONLY. A `needs_reconnect` or `plan_lapsed` row shows
  // its own card and displays neither the account nor the meeting, so asking
  // Calendly for them there buys nothing and costs a refresh round trip plus
  // two 8-second timeouts on a grant that is already known to be refused.
  if (hostId && chosen && (chosen.status === "connected" || chosen.status === "error") && chosen.event_type_uri) {
    try {
      const accessToken = await accessTokenForConnection(chosen)
      const subscriptionUri = chosen.webhook_subscription_uri
      const [identity, eventTypes, subscription] = await Promise.all([
        fetchIdentity({ accessToken }),
        chosen.calendly_user_uri ? listEventTypes({ accessToken, userUri: chosen.calendly_user_uri }) : [],
        // WRAPPED SEPARATELY, unlike its two siblings. "Is Calendly still
        // delivering?" is a different question from "whose account is this?",
        // and failing to answer it must not blank the two lines above. Three
        // outcomes, and they are three different things: a subscription
        // (Calendly's own state), `null` (Calendly 404s it — it is gone), and
        // `undefined` (we could not ask, so nothing is written and the stored
        // value stands).
        subscriptionUri
          ? getWebhookSubscription({ accessToken, subscriptionUri }).catch((err: unknown) => {
              console.warn("[admin/bookings/calendar] could not read the Calendly subscription's state", err)
              return undefined
            })
          : undefined,
      ])
      account = { name: identity.name, email: identity.email }
      const match = eventTypes.find((type) => type.uri === chosen.event_type_uri)
      if (match) meeting = { name: match.name, durationMinutes: match.durationMinutes }

      if (subscription !== undefined) {
        // `removed` is ours, not Calendly's — it has no state for a
        // subscription it no longer holds, and inventing `disabled` would
        // claim Calendly said something it did not. The card reads any
        // non-`active` value the same way: bookings are not arriving,
        // disconnect and connect again.
        webhookState = subscription ? subscription.state : "removed"
        await recordCoachCalendarWebhookState(chosen.id, webhookState).catch((err: unknown) => {
          console.warn("[admin/bookings/calendar] could not record the subscription's state", err)
        })
      }
    } catch (err) {
      console.warn("[admin/bookings/calendar] could not read this coach's Calendly account", err)
      accountReadFailed = true
      // `accessTokenForConnection` writes `needs_reconnect` when the grant is
      // genuinely dead, and it did so AFTER the row above was read. Re-read,
      // or this screen would report a working connection over one that has
      // just been marked as needing a new one.
      connection = await getCoachCalendarConnection(hostId).catch(() => connection)
    }
  }

  const view =
    connection && connection.status !== "not_connected"
      ? {
          status: connection.status,
          eventTypeUri: connection.event_type_uri,
          schedulingUrl: connection.scheduling_url,
          webhookState,
          conflictCheckedOn: connection.conflict_check_confirmed_at
            ? formatDay(connection.conflict_check_confirmed_at)
            : null,
          conflictConfirmed: connection.conflict_check_confirmed_at !== null,
          account,
          accountReadFailed,
          meeting,
        }
      : null

  return (
    <div>
      <Link
        href="/admin/bookings"
        className="mb-2 inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Back to Bookings
      </Link>
      <h1 className="mb-2 text-2xl font-semibold text-primary">Your calendar</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Connect your Calendly account here. We then show the times you are free, and every consult someone books.
      </p>

      <CalendarConnectionCard
        hasHost={hostId !== null}
        connection={view}
        flash={flashFor(params.calendar, params.reason)}
      />
    </div>
  )
}
