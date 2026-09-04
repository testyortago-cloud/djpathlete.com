// lib/bookings/calendly-tenant.ts
//
// WHOSE booking is this? The Calendly webhook is unauthenticated and carries
// no session, so the only tenant evidence a delivery holds is the event type
// it was booked against. 00240 made `coach_calendar_connections.event_type_uri`
// uniquely claimable with a partial unique index, so that match is a function
// rather than a heuristic: one event type cannot belong to two coaches.
//
// Three answers, and a fourth thing that is emphatically NOT an answer:
//
//   connection  a row claims this event type. Its business, host and id are
//               the tenant. This is the seam closed.
//   platform    no row claims it, but it is the one event type named by
//               CALENDLY_EVENT_TYPE_URI. The DEPLOY RAMP -- see below.
//   unknown     neither. Somebody else's event type, or a delivery carrying
//               no event type at all. The route acknowledges it with a 200.
//   (a throw)   the lookup could not be performed. NOT "no match" -- see below.
//
// WHY A RAMP RATHER THAN A HARD CUTOVER. Migrations reach production on push
// to main while Vercel is still building the code that uses them, and the
// owner then has to click Connect by hand. Without this branch, every real
// booking in that window would be silently dropped by a webhook that answered
// 200 and did nothing. It warns on every use so its lifetime is visible in the
// logs rather than indefinite and invisible.
//
// WHY A FAILED READ MUST THROW RATHER THAN RETURN "unknown". PostgREST
// resolves rather than throws, so a missing table, an expired JWT and a
// transient fault all arrive shaped exactly like "nothing matched". If this
// swallowed that, a momentary database fault would fall through to the ramp
// and file one coach's booking into another coach's tenant -- silently, with
// a 200, and with nothing afterwards to say it happened. So
// findCoachCalendarConnectionByEventType throws (see its own docstring), this
// propagates, and the route answers 500 so Calendly retries. This repo has
// shipped that exact confusion twice.
import { findCoachCalendarConnectionByEventType } from "@/lib/db/coach-calendar-connections"
import { platformBusinessId, platformHostId } from "@/lib/tenancy/platform"
import type { CoachCalendarConnection } from "@/types/database"

export type CalendlyTenant =
  | { kind: "connection"; businessId: string; hostId: string; connectionId: string }
  | { kind: "platform"; businessId: string; hostId: string | null }
  | { kind: "unknown" }

/**
 * Injection points, all optional and all defaulted to the real thing. The
 * tests inject the platform pair so the ramp can be exercised without a
 * database; nothing in the app passes deps.
 */
export interface ResolveCalendlyTenantDeps {
  findConnection?: (eventTypeUri: string) => Promise<CoachCalendarConnection | null>
  platformBusinessId?: () => string
  platformHostId?: () => Promise<string | null>
}

export async function resolveCalendlyTenant(
  eventTypeUri: string | null | undefined,
  deps: ResolveCalendlyTenantDeps = {},
): Promise<CalendlyTenant> {
  // FAILS CLOSED. A delivery with no event type cannot be proven to belong to
  // anyone, so it is nobody's -- never a ramp candidate. This preserves what
  // the env gate this function replaced already did.
  const eventType = eventTypeUri?.trim()
  if (!eventType) return { kind: "unknown" }

  const findConnection = deps.findConnection ?? findCoachCalendarConnectionByEventType

  // Deliberately not wrapped: a read that could not be performed must reach
  // the caller as a throw, not as an absence. See the header.
  const connection = await findConnection(eventType)
  if (connection) {
    return {
      kind: "connection",
      businessId: connection.business_id,
      hostId: connection.host_id,
      connectionId: connection.id,
    }
  }

  const rampEventType = process.env.CALENDLY_EVENT_TYPE_URI?.trim()
  if (rampEventType && rampEventType === eventType) {
    // Warned, not silent: the ramp is a temporary state of the install, and a
    // fallback nobody can see in the logs is one nobody ever removes.
    console.warn(
      `[calendly-tenant] no connection claims ${eventType}; falling back to the platform ramp (CALENDLY_EVENT_TYPE_URI)`,
    )
    return {
      kind: "platform",
      businessId: (deps.platformBusinessId ?? platformBusinessId)(),
      hostId: await (deps.platformHostId ?? platformHostId)(),
    }
  }

  return { kind: "unknown" }
}
