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

export async function getUpcomingBookings() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("status", "scheduled")
    .gte("booking_date", new Date().toISOString())
    .order("booking_date", { ascending: true })

  if (error) throw error
  return data as Booking[]
}

export async function getBookingById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("bookings").select("*").eq("id", id).single()

  if (error) throw error
  return data as Booking
}

export async function updateBookingStatus(id: string, status: BookingStatus, notes?: string) {
  const supabase = getClient()
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (notes !== undefined) updates.notes = notes

  const { data, error } = await supabase.from("bookings").update(updates).eq("id", id).select().single()

  if (error) throw error
  return data as Booking
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

export async function getBookingsInRange(from: Date, to: Date): Promise<Booking[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
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
): Promise<Pick<Booking, "id" | "contact_email" | "contact_phone" | "status" | "created_at">[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("bookings")
    .select("id, contact_email, contact_phone, status, created_at")
    .eq("business_id", businessId)
    .in("status", statuses)
    .gte("created_at", sinceIso)
  if (error) throw error
  return (data ?? []) as Pick<Booking, "id" | "contact_email" | "contact_phone" | "status" | "created_at">[]
}
