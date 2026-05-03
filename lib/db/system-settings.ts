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

/**
 * Combined per-job gate: true when the cron should be SKIPPED — either
 * because automation is globally paused OR the per-job toggle is off.
 *
 * Pass the system_settings key (e.g. "cron_voice_drift_enabled") and the
 * default value when no row exists. Existing crons should default to true
 * (preserves always-on behavior); opt-in crons default to false.
 */
export async function isCronSkipped(args: {
  enabledKey: string
  defaultEnabled: boolean
}): Promise<{ skipped: true; reason: "paused" | "disabled" } | { skipped: false }> {
  if (await isAutomationPaused()) return { skipped: true, reason: "paused" }
  const enabled = await getSetting<boolean>(args.enabledKey, args.defaultEnabled)
  if (!enabled) return { skipped: true, reason: "disabled" }
  return { skipped: false }
}
