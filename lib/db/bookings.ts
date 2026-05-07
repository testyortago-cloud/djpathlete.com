import { createServiceRoleClient } from "@/lib/supabase"
import type { Booking, BookingStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getBookings(status?: BookingStatus) {
  const supabase = getClient()
  let query = supabase.from("bookings").select("*").order("booking_date", { ascending: false })

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
