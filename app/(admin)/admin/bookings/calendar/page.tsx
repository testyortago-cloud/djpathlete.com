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
// TWO CALENDLY READS HAPPEN HERE, AND ONLY FOR A WORKING CONNECTION THAT HAS
// CHOSEN ITS MEETING: who the connection belongs to, and what that meeting is
// called.
// Neither is stored on the row — 00240 keeps URIs, not display names — and
// this screen is the only place either is needed, so there is nothing to cache
// them in. Both are wrapped: Calendly being unreachable must downgrade one
// line of the card, never blank the page. The PICKER's list is fetched by the
// card from the route instead, because that half is interactive and a coach
// who just added a meeting in Calendly wants the fresh list.
import Link from "next/link"

import { CalendarConnectionCard, type CalendarFlash } from "@/components/admin/bookings/CalendarConnectionCard"
import { fetchIdentity, listEventTypes } from "@/lib/calendly/account"
import { accessTokenForConnection } from "@/lib/calendly/credentials"
import { getPrimaryBookingHostId } from "@/lib/db/booking-hosts"
import { getCoachCalendarConnection } from "@/lib/db/coach-calendar-connections"
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

  const chosen = connection
  // `connected` and `error` ONLY. A `needs_reconnect` or `plan_lapsed` row shows
  // its own card and displays neither the account nor the meeting, so asking
  // Calendly for them there buys nothing and costs a refresh round trip plus
  // two 8-second timeouts on a grant that is already known to be refused.
  if (hostId && chosen && (chosen.status === "connected" || chosen.status === "error") && chosen.event_type_uri) {
    try {
      const accessToken = await accessTokenForConnection(chosen)
      const [identity, eventTypes] = await Promise.all([
        fetchIdentity({ accessToken }),
        chosen.calendly_user_uri ? listEventTypes({ accessToken, userUri: chosen.calendly_user_uri }) : [],
      ])
      account = { name: identity.name, email: identity.email }
      const match = eventTypes.find((type) => type.uri === chosen.event_type_uri)
      if (match) meeting = { name: match.name, durationMinutes: match.durationMinutes }
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
          webhookState: connection.webhook_state,
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
