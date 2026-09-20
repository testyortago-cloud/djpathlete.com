// lib/calendly/config-for-business.ts — the same four values
// `readCalendlyConfig()` reads out of the environment, resolved instead from
// ONE BUSINESS'S OWN Calendly connection when it has one.
//
// LIVE SINCE G19b. The public chat assistant
// (lib/lead-engine/chat/tools.ts) is the caller: it resolves the
// conversation's own tenant and asks here whose calendar to offer. Until then
// this file was deliberately inert while the chat read four environment
// variables naming the platform's account — the INBOUND half of Calendly had
// been per-tenant since 00240 (`resolveCalendlyTenant` matches a delivery's
// event type against `coach_calendar_connections`) and the outbound half had
// no equivalent. One tenant, one connection, so the two agreed and nothing
// looked wrong. See the platform gate below for what that would have cost on
// the day a second coach connected.
//
// "COULD NOT READ" IS NOT "NOT CONFIGURED", AND THE DIFFERENCE IS WHOSE DIARY
// ANSWERS. The two IDENTITY reads — `getPrimaryBookingHostId` and
// `getCoachCalendarConnection` — throw on failure on purpose, and this
// function does not catch them. Swallowing one and falling through to
// `readCalendlyConfig()` would answer one coach's "when are you free?" from
// the platform's calendar, silently, with a 200. A throw is loud and stops.
//
// THE TOKEN READ IS THE ONE EXCEPTION, and it is a different question rather
// than a softer answer to the same one. By the time it runs, the owner of the
// calendar is already established, so its failure cannot be mistaken for
// anybody else's diary — it means only "I cannot read THEIR times". That
// degrades to their own booking page with no times, the shape `book_consult`
// has always had for an unreadable calendar, instead of taking a working
// public page down with it. See the try/catch for the full reasoning.
//
// THE ENVIRONMENT FALLBACK IS THE PLATFORM'S ALONE. `CALENDLY_API_TOKEN`,
// `CALENDLY_EVENT_TYPE_URI` and `CALENDLY_SCHEDULING_URL` describe exactly one
// Calendly account — the platform's own — so handing them to a business that
// merely has not connected yet shows that coach's visitors the platform's free
// times and books them into the platform's diary. Silent, 200, and
// indistinguishable from working. So the fallback is gated on the business
// BEING the platform, and warns on every use, exactly as the inbound ramp in
// lib/bookings/calendly-tenant.ts does: a fallback nobody can see in the logs
// is one nobody ever removes. Any other business with no connection gets
// nothing, and its caller offers the plain consult path instead.
//
// Within the platform tenant, the fallback still fires only on POSITIVE
// evidence that it has no Calendly connection of its own to answer from:
//   * no `booking_hosts` row  — nothing a connection could hang off;
//   * no connection row       — nobody has connected an account;
//   * `not_connected`         — an account was connected and then removed;
//   * no `event_type_uri`     — connected, but the coach has not said which
//                               meeting is the consult, so there is no
//                               availability question this row can answer.
//
// A `needs_reconnect` or `plan_lapsed` row that HAS chosen its meeting is not
// in that list. It is a real connection whose token may or may not still work,
// so it goes down the normal path and `accessTokenForConnection` decides. If
// the grant is dead, the answer is that coach's own booking page with NO
// times — never the environment's calendar. That is the property to preserve:
// a coach whose Calendly access has lapsed must not have their availability
// answered out of someone else's diary, and equally must not lose their own
// working booking page over it.

import {
  CALENDLY_API_BASE_DEFAULT,
  readCalendlyConfig,
  readCalendlySchedulingUrl,
  type CalendlyConfig,
} from "@/lib/calendly/env"
import { accessTokenForConnection } from "@/lib/calendly/credentials"
import { getPrimaryBookingHostId } from "@/lib/db/booking-hosts"
import { getCoachCalendarConnection } from "@/lib/db/coach-calendar-connections"
import { platformBusinessId } from "@/lib/tenancy/platform"

/** The one reason `CALENDLY_API_BASE` exists: the acceptance script's local fixture server. */
function apiBase(): string {
  const override = process.env.CALENDLY_API_BASE?.trim()
  return override && override.length > 0 ? override : CALENDLY_API_BASE_DEFAULT
}

/**
 * What a business can offer a visitor who asks to book, in the two pieces that
 * fail independently.
 *
 * They are separate because a HALF-configured install is ordinary: the owner
 * pastes the public booking page long before they paste an API token, and a
 * link the visitor can click is worth having on its own. `config` present
 * means real times can be read; `schedulingUrl` present means there is a page
 * to send them to. `config` is never present without `schedulingUrl`.
 */
export type CalendlyBookingOffer = {
  /** Everything an availability read needs, or null when times cannot be read. */
  config: CalendlyConfig | null
  /** The public booking page, or null when this business has none to offer. */
  schedulingUrl: string | null
}

const NO_OFFER: CalendlyBookingOffer = { config: null, schedulingUrl: null }

/**
 * The environment's single Calendly account — offered to the platform's own
 * business and to nobody else. See the file header for why the gate is here
 * rather than at the call site.
 */
function platformEnvironmentOffer(businessId: string): CalendlyBookingOffer {
  if (businessId !== platformBusinessId()) return NO_OFFER

  const config = readCalendlyConfig()
  const schedulingUrl = config?.schedulingUrl ?? readCalendlySchedulingUrl()
  // Warned only when it actually supplies something: a platform install with
  // no Calendly at all is not on a ramp, it is simply unconfigured.
  if (schedulingUrl) {
    console.warn(
      `[calendly] business ${businessId} has no Calendly connection; falling back to the platform environment (CALENDLY_SCHEDULING_URL)`,
    )
  }
  return { config, schedulingUrl }
}

/**
 * Whose calendar `businessId` offers, and whether its times can be read.
 *
 * @throws whatever the two IDENTITY reads throw. That means "I could not find
 * out whose calendar this is", which is a different answer from "they have
 * nothing to offer" and must not be confused with it — see the file header. A
 * failing TOKEN does not throw: the owner is known by then, so it degrades to
 * their own page with no times.
 */
export async function calendlyBookingOfferForBusiness(businessId: string): Promise<CalendlyBookingOffer> {
  const hostId = await getPrimaryBookingHostId(businessId)
  if (hostId === null) return platformEnvironmentOffer(businessId)

  const connection = await getCoachCalendarConnection(hostId)
  if (!connection || connection.status === "not_connected" || !connection.event_type_uri) {
    return platformEnvironmentOffer(businessId)
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
    return NO_OFFER
  }

  // THE TOKEN IS RESOLVED SEPARATELY, AND ITS FAILURE COSTS THE TIMES ONLY.
  // Inside the object literal below this `await` would throw the coach's own
  // `scheduling_url` away with it, so a lapsed grant or one 503 from Calendly's
  // token endpoint would replace a perfectly good booking page with `/contact`
  // — the two halves failing together, which is exactly what this type's
  // docstring promises they do not do.
  //
  // THIS IS NOT THE CATCH THE HEADER FORBIDS, and the difference is what the
  // failed read was ASKING. The two reads above answer "whose calendar is
  // this?", and not knowing that must stop everything, because the only
  // available guess is somebody else's diary. This one answers "can I read
  // their times?" with the owner already established — a could-not-read of
  // exactly the kind `book_consult` has always degraded to a link for.
  let apiToken: string
  try {
    apiToken = await accessTokenForConnection(connection)
  } catch (err) {
    console.warn(
      `[calendly] connection ${connection.id} could not produce an access token (${(err as Error).message}) — offering its booking page with no times`,
    )
    return { config: null, schedulingUrl: connection.scheduling_url }
  }

  return {
    config: {
      apiToken,
      eventTypeUri: connection.event_type_uri,
      schedulingUrl: connection.scheduling_url,
      apiBase: apiBase(),
    },
    schedulingUrl: connection.scheduling_url,
  }
}

/**
 * The availability half alone, for callers that have no use for a bare link.
 *
 * The shape is exactly `readCalendlyConfig()`'s, so an existing caller changes
 * only where it gets the value, never what it does with it.
 */
export async function calendlyConfigForBusiness(businessId: string): Promise<CalendlyConfig | null> {
  return (await calendlyBookingOfferForBusiness(businessId)).config
}
