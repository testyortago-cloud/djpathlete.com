// functions/src/lib/system-settings.ts
// Mirror of lib/db/system-settings.ts for the Firebase Functions side.
// Used by every Phase 5 scheduled runner to gate execution on the global
// automation_paused flag.

import type { SupabaseClient } from "@supabase/supabase-js"
import { getSupabase } from "./supabase.js"

export async function getSetting<T>(key: string, fallback: T, supabase?: SupabaseClient): Promise<T> {
  try {
    const client = supabase ?? getSupabase()
    const { data, error } = await client.from("system_settings").select("value").eq("key", key).maybeSingle()
    if (error) return fallback
    if (!data) return fallback
    return data.value as T
  } catch {
    // Fail-open: if the settings lookup itself throws (missing table, bad
    // stub in tests, etc.), fall back to the caller-supplied default rather
    // than crashing the runner.
    return fallback
  }
}

/**
 * Global kill switch. Defaults to false (not paused) on any error so a flaky
 * settings read never silently pauses the whole automation stack.
 */
export async function isAutomationPaused(supabase?: SupabaseClient): Promise<boolean> {
  return getSetting<boolean>("automation_paused", false, supabase)
}
