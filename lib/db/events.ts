import { createServiceRoleClient } from "@/lib/supabase"
import type { Event, EventStatus, EventType } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface EventListFilters {
  type?: EventType
  status?: EventStatus
  search?: string
}

export async function getEvents(filters: EventListFilters = {}): Promise<Event[]> {
  const supabase = getClient()
  let query = supabase.from("events").select("*").order("start_date", { ascending: true })
  if (filters.type) query = query.eq("type", filters.type)
  if (filters.status) query = query.eq("status", filters.status)
  if (filters.search) query = query.ilike("title", `%${filters.search}%`)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Event[]
}

export async function getPublishedEvents(
  filters: { type?: EventType; from?: Date } = {},
): Promise<Event[]> {
  const supabase = getClient()
  const from = filters.from ?? new Date()
  let query = supabase
    .from("events")
    .select("*")
    .eq("status", "published")
    .gte("start_date", from.toISOString())
    .order("start_date", { ascending: true })
  if (filters.type) query = query.eq("type", filters.type)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Event[]
}

export async function getEventById(id: string): Promise<Event | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("events").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as Event) ?? null
}

export async function getEventBySlug(slug: string): Promise<Event | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("events").select("*").eq("slug", slug).maybeSingle()
  if (error) throw error
  return (data as Event) ?? null
}
