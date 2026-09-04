// lib/bookings/calendar-access.ts — the one gate the five
// /api/admin/bookings/calendar routes share.
//
// WHY THESE ROUTES SIT UNDER /api/admin/bookings AT ALL. That prefix maps to
// the `schedule` permission (lib/permissions/registry.ts), so a coach reaches
// it. The owner's decision is that each coach owns and pays for their own
// Calendly account, which means a coach must be able to connect one
// themselves. Putting these under /admin/businesses — an OWNER_ONLY prefix —
// would have meant only the operator could ever connect a coach's calendar.
//
// THREE INDEPENDENT QUESTIONS, ASKED IN ORDER, because they fail differently:
//   1. Is there a session at all?                      -> 401
//   2. May this actor touch this path?                 -> 403
//   3. Which business is it acting for, and does that
//      business have a host to hang a calendar off?    -> 403 / hostId: null
//
// A `NoAccessibleBusinessError` is a 403, not a 500: it means the caller holds
// no membership on any active business, which is a denial, not a fault. Every
// other error propagates, because a failed businesses read must look like an
// outage rather than like a revoked coach.
import { auth } from "@/lib/auth"
import { getPrimaryBookingHostId } from "@/lib/db/booking-hosts"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"

export type CalendarAccessGranted = {
  ok: true
  /** The caller's CURRENTLY SELECTED business. Driven by a cookie — see the callback route. */
  businessId: string
  /** Every business the caller may act on. The callback checks the signed state against this. */
  businessChoices: string[]
  isOperator: boolean
  userId: string
  /** `null` when the business has no `booking_hosts` row — nothing to attach a calendar to. */
  hostId: string | null
}

export type CalendarAccessDenied = { ok: false; status: 401 | 403; error: string }

export type CalendarAccess = CalendarAccessGranted | CalendarAccessDenied

export async function resolveCalendarAccess(request: Request): Promise<CalendarAccess> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, status: 401, error: "Sign in required." }
  if (!(await canAccessAdminPath(session.user, request))) {
    return { ok: false, status: 403, error: "Forbidden" }
  }

  let businessId: string
  let choices: { id: string }[]
  let isOperator: boolean
  try {
    const tenant = await resolveAdminTenantForRequest(request)
    businessId = tenant.businessId
    choices = tenant.choices
    isOperator = tenant.isOperator
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) return { ok: false, status: 403, error: "Forbidden" }
    throw err
  }

  return {
    ok: true,
    businessId,
    businessChoices: choices.map((c) => c.id),
    isOperator,
    userId: session.user.id,
    hostId: await getPrimaryBookingHostId(businessId),
  }
}
