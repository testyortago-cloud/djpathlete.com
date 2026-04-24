import { createServiceRoleClient } from "@/lib/supabase"
import type { Event, EventStatus, EventType } from "@/types/database"
import type { CreateEventInput, UpdateEventInput } from "@/lib/validators/events"

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

export async function getPublishedEvents(filters: { type?: EventType; from?: Date } = {}): Promise<Event[]> {
  const supabase = getClient()
  const from = filters.from ?? new Date()
  // An event is "upcoming" until it ends, not until it starts. Clinics auto-set
  // end_date to start + 2h at create time; camps have an explicit end_date.
  // Filtering on end_date keeps a same-day event visible during its session
  // instead of vanishing at the exact start time.
  let query = supabase
    .from("events")
    .select("*")
    .eq("status", "published")
    .gte("end_date", from.toISOString())
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

function computeEndDate(type: EventType, startIso: string, inputEnd?: string | null): string | null {
  if (type === "clinic") {
    return new Date(new Date(startIso).getTime() + 2 * 3600 * 1000).toISOString()
  }
  return inputEnd ?? null
}

export async function createEvent(input: CreateEventInput): Promise<Event> {
  const supabase = getClient()
  const base = {
    type: input.type,
    slug: input.slug,
    title: input.title,
    summary: input.summary,
    description: input.description,
    focus_areas: input.focus_areas,
    location_name: input.location_name,
    location_address: input.location_address ?? null,
    location_map_url: input.location_map_url ?? null,
    capacity: input.capacity,
    hero_image_url: input.hero_image_url ?? null,
    status: input.status,
    age_min: input.age_min ?? null,
    age_max: input.age_max ?? null,
    start_date: input.start_date,
    end_date: input.type === "clinic" ? computeEndDate("clinic", input.start_date) : input.end_date,
    session_schedule: input.type === "camp" ? (input.session_schedule ?? null) : null,
    price_cents: input.price_dollars != null ? Math.round(input.price_dollars * 100) : null,
  }
  const { data, error } = await supabase.from("events").insert(base).select().single()
  if (error) throw error
  return data as Event
}

export async function updateEvent(id: string, input: UpdateEventInput): Promise<Event> {
  const supabase = getClient()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const [key, value] of Object.entries(input)) {
    if (key === "price_dollars") {
      updates.price_cents = value == null ? null : Math.round((value as number) * 100)
    } else if (value !== undefined) {
      updates[key] = value
    }
  }
  // If start_date changed for a clinic, recompute end_date.
  if (updates.start_date && !("end_date" in updates)) {
    const existing = await getEventById(id)
    if (existing?.type === "clinic") {
      updates.end_date = computeEndDate("clinic", updates.start_date as string)
    }
  }
  const { data, error } = await supabase.from("events").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as Event
}

export const ALLOWED_STATUS_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  draft: ["published", "cancelled"],
  published: ["cancelled", "completed"],
  cancelled: [],
  completed: [],
}

export async function setEventStatus(id: string, status: EventStatus): Promise<Event> {
  const current = await getEventById(id)
  if (!current) throw new Error(`Event ${id} not found`)
  const allowed = ALLOWED_STATUS_TRANSITIONS[current.status]
  if (!allowed.includes(status)) {
    throw new Error(`Cannot transition event from ${current.status} to ${status}`)
  }
  return updateEvent(id, { status })
}

export interface DeleteEventOptions {
  /**
   * Bypass the signup-count safety check. With force=true, the FK's
   * ON DELETE CASCADE on event_signups removes all attached signup
   * records along with the event. Use sparingly — typically reserved
   * for test events or events the admin knows should be fully purged.
   */
  force?: boolean
}

export async function deleteEvent(id: string, opts: DeleteEventOptions = {}): Promise<void> {
  const event = await getEventById(id)
  if (!event) return
  if (!opts.force && event.signup_count > 0) {
    throw new Error("Cannot delete an event with existing signups; cancel the event instead")
  }
  const supabase = getClient()
  const { error } = await supabase.from("events").delete().eq("id", id)
  if (error) throw error
}
