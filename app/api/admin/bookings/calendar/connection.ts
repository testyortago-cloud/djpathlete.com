// app/api/admin/bookings/calendar/connection.ts — the read the three
// post-connect routes all start with: "which connection am I acting on, and is
// it usable yet?"
//
// The answer is deliberately a small union rather than `Connection | null`.
// "No business host", "not connected yet" and "connected but with no Calendly
// user recorded" are three different sentences on the coach's screen, and a
// single null would flatten them into one unhelpful one.
//
// Not a route file: Next's App Router only treats route.ts / page.tsx and
// friends as routes.

import { NextResponse } from "next/server"

import { resolveCalendarAccess, type CalendarAccessGranted } from "@/lib/bookings/calendar-access"
import { getCoachCalendarConnection } from "@/lib/db/coach-calendar-connections"
import type { CoachCalendarConnection } from "@/types/database"

export type CalendarConnectionContext = {
  access: CalendarAccessGranted
  hostId: string
  connection: CoachCalendarConnection
}

/**
 * Either the context, or the response to return. A route's whole preamble
 * becomes:
 *
 *     const ctx = await requireCalendarConnection(request)
 *     if ("response" in ctx) return ctx.response
 */
export async function requireCalendarConnection(
  request: Request,
): Promise<CalendarConnectionContext | { response: NextResponse }> {
  const access = await resolveCalendarAccess(request)
  if (!access.ok) {
    return { response: NextResponse.json({ error: access.error }, { status: access.status }) }
  }
  if (!access.hostId) {
    return {
      response: NextResponse.json(
        { error: "This business has no calendar host yet, so there is no calendar to work with." },
        { status: 409 },
      ),
    }
  }

  const connection = await getCoachCalendarConnection(access.hostId)
  if (!connection || connection.status === "not_connected") {
    return {
      response: NextResponse.json({ error: "Connect your Calendly account first." }, { status: 409 }),
    }
  }

  return { access, hostId: access.hostId, connection }
}
