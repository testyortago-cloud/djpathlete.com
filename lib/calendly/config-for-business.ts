// lib/calendly/config-for-business.ts — the same four values
// `readCalendlyConfig()` reads out of the environment, resolved instead from
// ONE BUSINESS'S OWN Calendly connection when it has one.
//
// THIS IS INERT TODAY, DELIBERATELY. Nothing calls it yet: the public chat
// assistant (lib/lead-engine/chat/tools.ts) resolves its tenant with
// `platformBusinessId()` until phase 4 teaches it to read the `Host` header,
// so the business it is asking about is the platform's own and
// `readCalendlyConfig()` is the same answer either way. Building it now means
// phase 4 changes one resolver, instead of also discovering that availability
// was hard-wired to four environment variables and unpicking that under
// deadline. (Phase 4 has a second half to do at the same call site: the
// FALLBACK LINK there still comes from `readCalendlySchedulingUrl()`, which is
// the platform's page. This function does not fix that, and cannot — its
// caller chooses the link.)
//
// "COULD NOT READ" IS NOT "NOT CONFIGURED", AND THE DIFFERENCE IS WHOSE DIARY
// ANSWERS. Every read here throws on failure — `getPrimaryBookingHostId` and
// `getCoachCalendarConnection` both do so on purpose — and this function does
// not catch. Swallowing a failed read and falling through to
// `readCalendlyConfig()` would answer one coach's "when are you free?" from
// the platform's calendar, silently, with a 200. A throw is loud and stops.
//
// The fallback therefore fires only on POSITIVE evidence that this business
// has no Calendly of its own to answer from:
//   * no `booking_hosts` row  — nothing a connection could hang off;
//   * no connection row       — nobody has connected an account;
//   * `not_connected`         — an account was connected and then removed;
//   * no `event_type_uri`     — connected, but the coach has not said which
//                               meeting is the consult, so there is no
//                               availability question this row can answer.
//
// A `needs_reconnect` or `plan_lapsed` row that HAS chosen its meeting is not
// in that list. It is a real connection whose token may or may not still work,
// so it goes down the normal path and `accessTokenForConnection` decides —
// throwing if the grant is dead. That is the correct outcome: a coach whose
// Calendly access has lapsed must not have their availability answered out of
// someone else's calendar.

import { CALENDLY_API_BASE_DEFAULT, readCalendlyConfig, type CalendlyConfig } from "@/lib/calendly/env"
import { accessTokenForConnection } from "@/lib/calendly/credentials"
import { getPrimaryBookingHostId } from "@/lib/db/booking-hosts"
import { getCoachCalendarConnection } from "@/lib/db/coach-calendar-connections"

/** The one reason `CALENDLY_API_BASE` exists: the acceptance script's local fixture server. */
function apiBase(): string {
  const override = process.env.CALENDLY_API_BASE?.trim()
  return override && override.length > 0 ? override : CALENDLY_API_BASE_DEFAULT
}

/**
 * Everything an availability read needs for `businessId`, or `null` when
 * nobody — this business or the platform — has a Calendly to answer from.
 *
 * The shape is exactly `readCalendlyConfig()`'s, so an existing caller changes
 * only where it gets the value, never what it does with it.
 *
 * @throws whatever the connection reads throw, and whatever
 * `accessTokenForConnection` throws. Both mean "could not read", which is a
 * different answer from "not configured" — see the file header.
 */
export async function calendlyConfigForBusiness(businessId: string): Promise<CalendlyConfig | null> {
  const hostId = await getPrimaryBookingHostId(businessId)
  if (hostId === null) return readCalendlyConfig()

  const connection = await getCoachCalendarConnection(hostId)
  if (!connection || connection.status === "not_connected" || !connection.event_type_uri) {
    return readCalendlyConfig()
  }

  // A chosen meeting with no public page recorded alongside it is a row half
  // written by some earlier failure. It cannot produce a whole config, and it
  // must not fall through to the platform's: this business demonstrably has
  // its own connection, so the platform's calendar would be the wrong coach's.
  // Answering nothing is the only safe reading of a broken row.
  if (!connection.scheduling_url) {
    console.warn(
      `[calendly] connection ${connection.id} has an event type but no public booking page — answering no availability`,
    )
    return null
  }

  return {
    apiToken: await accessTokenForConnection(connection),
    eventTypeUri: connection.event_type_uri,
    schedulingUrl: connection.scheduling_url,
    apiBase: apiBase(),
  }
}
