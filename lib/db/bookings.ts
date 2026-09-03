import { createServiceRoleClient } from "@/lib/supabase"
import type { Booking, BookingStatus } from "@/types/database"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

function getClient() {
  return createServiceRoleClient()
}

/**
 * The one host of the one business, for the two adapters that still resolve
 * their tenant from a constant. Phase 2 replaces both call sites with the host
 * on the coach_calendar_connections row the delivery matched; until then this
 * is the honest way to say "the singleton's host" without hard-coding a uuid
 * that only exists because a backfill created it.
 *
 * Returns null rather than throwing on a read failure — a throw here would
 * 500 the booking webhook for what might be a transient read, which is worse
 * than proceeding without a host. But since migration 00243, `bookings.host_id`
 * is NOT NULL: a null return now means the insert that follows WILL fail with
 * 23502 (not_null_violation), and the console.error below is the only
 * diagnostic that survives — without it, "the table doesn't exist" and "there
 * really is no host row yet" are indistinguishable from the 23502 alone.
 * PostgREST resolves a read failure rather than throwing (same as the
 * business_members fan-out read in lib/bookings/ingest.ts), so `error` is
 * checked explicitly here instead of relying on a try/catch that would never
 * fire. Phase 2 removes this function's only two call sites in favour of the
 * host on the coach_calendar_connections row the delivery matched, which
 * makes this whole read (and its failure mode) go away.
 */
export async function singletonHostId(): Promise<string | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("booking_hosts")
    .select("id")
    .eq("business_id", SINGLETON_BUSINESS_ID)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error(`[booking-hosts] singletonHostId read failed (${error.code} ${error.message})`)
    return null
  }
  return (data as { id: string } | null)?.id ?? null
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

export async function getBookingStats() {
  const supabase = getClient()

  const [scheduled, completed, cancelled, noShow] = await Promise.all([
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "scheduled"),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "completed"),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "cancelled"),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "no_show"),
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
 */
export async function getBookingsForPipelineReconcile(
  statuses: BookingStatus[],
  sinceIso: string,
): Promise<Pick<Booking, "id" | "contact_email" | "contact_phone" | "status" | "created_at">[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("bookings")
    .select("id, contact_email, contact_phone, status, created_at")
    .in("status", statuses)
    .gte("created_at", sinceIso)
  if (error) throw error
  return (data ?? []) as Pick<Booking, "id" | "contact_email" | "contact_phone" | "status" | "created_at">[]
}
