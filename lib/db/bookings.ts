import { createServiceRoleClient } from "@/lib/supabase"
import type { Booking, BookingStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

/**
 * `businessId` is REQUIRED and comes first. This function previously applied
 * NO business predicate at all -- not a default, an absence -- so every
 * admin bookings list read every business's rows. Not a leak while one
 * business existed; a leak the moment a second one does.
 */
export async function getBookings(businessId: string, status?: BookingStatus) {
  const supabase = getClient()
  let query = supabase
    .from("bookings")
    .select("*")
    .eq("business_id", businessId)
    .order("booking_date", { ascending: false })

  if (status) {
    query = query.eq("status", status)
  }

  const { data, error } = await query
  if (error) throw error
  return data as Booking[]
}

/**
 * One booking, IN THIS BUSINESS, or `null` (G35).
 *
 * `businessId` is REQUIRED and comes first. This read used to filter on `id`
 * alone, and its only caller is `PATCH /api/admin/bookings`, which the
 * grantable `schedule` permission reaches and which answers with the row's
 * contact name, email and phone. A booking id from another business must
 * read as absent, the same as an id that does not exist.
 *
 * `maybeSingle`, not `single`: "no such booking here" is an answer the route
 * turns into a 404, not an error. `.single()` reported it as PGRST116, which
 * the route could only answer with a 500. A real read failure still throws.
 */
export async function getBookingById(businessId: string, id: string): Promise<Booking | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle()

  if (error) throw error
  return (data as Booking | null) ?? null
}

/**
 * Sets one booking's status (and optionally its notes), IN THIS BUSINESS.
 * Returns the updated row, or `null` when no booking with this id exists in
 * this business (G35).
 *
 * The predicate is on the UPDATE itself, not only on the read the route makes
 * before it: a read-then-write where only the read is scoped is a check, and
 * the write is where the damage happens. `.select().maybeSingle()` because
 * PostgREST reports no error for an UPDATE that matches zero rows (the same
 * reasoning as `updatePipelineBoard` in lib/db/pipeline.ts): `data` null with
 * no `error` is exactly the foreign-or-missing case, and the caller must be
 * able to tell it from a success.
 */
export async function updateBookingStatus(
  businessId: string,
  id: string,
  status: BookingStatus,
  notes?: string,
): Promise<Booking | null> {
  const supabase = getClient()
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (notes !== undefined) updates.notes = notes

  const { data, error } = await supabase
    .from("bookings")
    .update(updates)
    .eq("id", id)
    .eq("business_id", businessId)
    .select()
    .maybeSingle()

  if (error) throw error
  return (data as Booking | null) ?? null
}

/**
 * `businessId` is REQUIRED, same reasoning as `getBookings` above: these four
 * counts previously carried NO business predicate at all, so the tiles on the
 * bookings page counted every business's rows while the list beneath them
 * showed only one.
 */
export async function getBookingStats(businessId: string) {
  const supabase = getClient()

  const [scheduled, completed, cancelled, noShow] = await Promise.all([
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "scheduled"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "completed"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "cancelled"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "no_show"),
  ])

  return {
    upcoming: scheduled.count ?? 0,
    completed: completed.count ?? 0,
    cancelled: cancelled.count ?? 0,
    noShow: noShow.count ?? 0,
  }
}

/**
 * Bookings whose `booking_date` falls in `[from, to)`, IN THIS BUSINESS.
 *
 * `businessId` is REQUIRED and comes first (G35). This read had no business
 * predicate, so the Daily Brief's "calls today" listed every business's
 * calls, by the booker's name, in an email sent to the platform's coach —
 * while the signup count beside it in the same section was already scoped.
 */
export async function getBookingsInRange(businessId: string, from: Date, to: Date): Promise<Booking[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("business_id", businessId)
    .gte("booking_date", from.toISOString())
    .lt("booking_date", to.toISOString())
    .order("booking_date", { ascending: true })
  if (error) throw error
  return (data ?? []) as Booking[]
}

/**
 * Feeds the Lead Engine pipeline reconciler (lib/automation/pipeline-reconcile.ts,
 * Task 6): rows in `statuses` written since `sinceIso`. Filters on
 * `created_at` (when the row entered the DB — the moment a dropped webhook
 * would have fired), never `booking_date` (which can be a future
 * appointment time or a backfilled past one, neither of which says anything
 * about when the hook ran).
 *
 * `businessId` is REQUIRED (Task 10 fix round 1). This function previously
 * applied NO business predicate at all — same absence as `getBookings`
 * above had, and the same consequence: `bookings.business_id` exists
 * (migration 00240) but was never filtered on here. Not a leak while one
 * business existed, but a real one the moment a second does: the
 * reconciler resolves a booking's contact via `findContactByIdentifiers`,
 * which matches by email/phone WITHIN a business — and a shared email is
 * the ordinary multi-tenant case (one person training with two coaches),
 * not an edge case. An unscoped read here let business B's reconciler pass
 * business A's booking through to `findContactByIdentifiers({..., business
 * Id: B})`, which happily resolved it to B's contact record and created a
 * cross-tenant opportunity. Confirmed with a probe before this fix: two
 * active businesses, one booking, one person who is a contact of both →
 * `createdFromBookings: 2` (see
 * __tests__/lib/automation/pipeline-reconcile.test.ts's "does not create a
 * cross-tenant opportunity" test, which fails without this filter).
 */
export async function getBookingsForPipelineReconcile(
  statuses: BookingStatus[],
  sinceIso: string,
  businessId: string,
): Promise<Pick<Booking, "id" | "contact_email" | "contact_phone" | "status" | "created_at" | "service_type">[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("bookings")
    // `service_type` (G26) is what lets the reconciler route a replayed
    // booking to the SAME board the live webhook chose. Without it in the
    // projection the value reads `undefined`, which routes to Coaching exactly
    // as the old hard-coded key did — the bug, silently intact.
    .select("id, contact_email, contact_phone, status, created_at, service_type")
    .eq("business_id", businessId)
    .in("status", statuses)
    .gte("created_at", sinceIso)
  if (error) throw error
  return (data ?? []) as Pick<
    Booking,
    "id" | "contact_email" | "contact_phone" | "status" | "created_at" | "service_type"
  >[]
}
