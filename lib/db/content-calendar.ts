// lib/db/content-calendar.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { ContentCalendarEntry, CalendarEntryType, CalendarStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createCalendarEntry(
  entry: Omit<ContentCalendarEntry, "id" | "created_at" | "updated_at">,
): Promise<ContentCalendarEntry> {
  const supabase = getClient()
  const { data, error } = await supabase.from("content_calendar").insert(entry).select().single()
  if (error) throw error
  return data as ContentCalendarEntry
}

export async function getCalendarEntryById(id: string): Promise<ContentCalendarEntry | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("content_calendar")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as ContentCalendarEntry | null) ?? null
}

export interface ListCalendarFilters {
  entry_type?: CalendarEntryType
  status?: CalendarStatus
  from_date?: string
  to_date?: string
}

export async function listCalendarEntries(
  filters: ListCalendarFilters = {},
): Promise<ContentCalendarEntry[]> {
  const supabase = getClient()
  let query = supabase
    .from("content_calendar")
    .select("*")
    .order("scheduled_for", { ascending: true })
  if (filters.entry_type) query = query.eq("entry_type", filters.entry_type)
  if (filters.status) query = query.eq("status", filters.status)
  if (filters.from_date) query = query.gte("scheduled_for", filters.from_date)
  if (filters.to_date) query = query.lte("scheduled_for", filters.to_date)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as ContentCalendarEntry[]
}

export async function updateCalendarEntry(
  id: string,
  updates: Partial<Omit<ContentCalendarEntry, "id" | "created_at">>,
): Promise<ContentCalendarEntry> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("content_calendar")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as ContentCalendarEntry
}

export async function deleteCalendarEntry(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("content_calendar").delete().eq("id", id)
  if (error) throw error
}
