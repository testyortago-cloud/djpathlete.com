// lib/db/system-settings.ts
// Generic key-value ops flag store. Used by the admin /admin/automation page
// and by the Phase 5 scheduled runners (which check isAutomationPaused() at
// the top of each run).

import { createServiceRoleClient } from "@/lib/supabase"
import type { SystemSetting } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const supabase = getClient()
  const { data, error } = await supabase.from("system_settings").select("value").eq("key", key).maybeSingle()
  if (error) throw error
  if (!data) return fallback
  return data.value as T
}

export async function setSetting(key: string, value: unknown, updatedBy: string | null = null): Promise<SystemSetting> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("system_settings")
    .upsert(
      {
        key,
        value,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    )
    .select()
    .single()
  if (error) throw error
  return data as SystemSetting
}

export async function isAutomationPaused(): Promise<boolean> {
  return getSetting<boolean>("automation_paused", false)
}
