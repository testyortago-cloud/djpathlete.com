// functions/src/lib/cron-runs.ts (Firebase-side twin)
// Mirror of lib/db/cron-runs.ts. Functions/ cannot import from lib/ so the
// shapes are duplicated. Keep these two files in sync.

import type { SupabaseClient } from "@supabase/supabase-js"

export type CronStatus = "running" | "success" | "failed"

export async function logCronStart(
  supabase: SupabaseClient,
  cron_name: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("cron_runs")
    .insert({ cron_name, status: "running" })
    .select("id")
    .single()
  if (error) {
    console.error(`[cron_runs] logCronStart(${cron_name}) failed:`, error.message)
    return null
  }
  return (data as { id: string }).id
}

export async function logCronEnd(
  supabase: SupabaseClient,
  id: string | null,
  status: "success" | "failed",
  detail: Record<string, unknown> = {},
): Promise<void> {
  if (!id) return
  const { error } = await supabase
    .from("cron_runs")
    .update({ status, detail, finished_at: new Date().toISOString() })
    .eq("id", id)
  if (error) console.error(`[cron_runs] logCronEnd(${id}) failed:`, error.message)
}

export async function lastSuccessPerCron(
  supabase: SupabaseClient,
  cron_names: string[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  for (const name of cron_names) {
    const { data } = await supabase
      .from("cron_runs")
      .select("finished_at")
      .eq("cron_name", name)
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    out[name] = (data?.finished_at as string | undefined) ?? null
  }
  return out
}
