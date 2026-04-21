import { createServiceRoleClient } from "@/lib/supabase"
import type { UserPreferences, CalendarDefaultView } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

const DEFAULTS: Omit<UserPreferences, "user_id" | "updated_at"> = {
  calendar_default_view: "month",
  last_pipeline_filters: {},
  pipeline_lanes_collapsed: {},
}

export async function getPreferences(userId: string): Promise<UserPreferences> {
  const supabase = getClient()
  const { data, error } = await supabase.from("user_preferences").select("*").eq("user_id", userId).maybeSingle()
  if (error) throw error
  if (!data) {
    return {
      user_id: userId,
      ...DEFAULTS,
      updated_at: new Date().toISOString(),
    }
  }
  return data as UserPreferences
}

export interface PreferencesPatch {
  calendar_default_view?: CalendarDefaultView
  last_pipeline_filters?: Record<string, unknown>
  pipeline_lanes_collapsed?: Record<string, boolean>
}

export async function upsertPreferences(userId: string, patch: PreferencesPatch): Promise<UserPreferences> {
  const supabase = getClient()
  const existing = await getPreferences(userId)
  const next = {
    user_id: userId,
    calendar_default_view: patch.calendar_default_view ?? existing.calendar_default_view,
    last_pipeline_filters: patch.last_pipeline_filters ?? existing.last_pipeline_filters,
    pipeline_lanes_collapsed: patch.pipeline_lanes_collapsed ?? existing.pipeline_lanes_collapsed,
  }
  const { data, error } = await supabase
    .from("user_preferences")
    .upsert(next, { onConflict: "user_id" })
    .select()
    .single()
  if (error) throw error
  return data as UserPreferences
}
