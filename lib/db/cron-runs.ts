// lib/db/cron-runs.ts (Next.js-side twin)
// Mirror of functions/src/lib/cron-runs.ts. Used by Next.js internal routes
// that want to log their own runs in cron_runs (e.g. /admin/automation manual
// trigger endpoints). The Firebase-side twin must stay in sync with this one.

import type { SupabaseClient } from "@supabase/supabase-js"

export interface CronRun {
  id: string
  cron_name: string
  started_at: string
  finished_at: string | null
  status: "running" | "success" | "failed"
  detail: Record<string, unknown> | null
}

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
  if (!id) return // start failed; nothing to update
  const { error } = await supabase
    .from("cron_runs")
    .update({ status, detail, finished_at: new Date().toISOString() })
    .eq("id", id)
  if (error) console.error(`[cron_runs] logCronEnd(${id}) failed:`, error.message)
}

/** Latest run (any status) for one cron, else null. Setup checklist reads
 *  bookkeepingGmailReceiptsCron's detail.label_missing telemetry through this. */
export async function latestCronRun(
  supabase: SupabaseClient,
  cron_name: string,
): Promise<CronRun | null> {
  const { data, error } = await supabase
    .from("cron_runs")
    .select("*")
    .eq("cron_name", cron_name)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error(`[cron_runs] latestCronRun(${cron_name}) failed:`, error.message)
    return null
  }
  return (data as CronRun) ?? null
}

export interface LastSuccess {
  cron_name: string
  last_success_at: string | null
}

/**
 * For each expected cron name, return when it last succeeded (or null).
 * Used by the automation-health scanner.
 */
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

/**
 * For each named cron, when its most recent FAILED run was (or null).
 * Read by the automation-health scanner for crons that have never succeeded,
 * where a failure row is the difference between "the deploy never reached it"
 * and "it runs and loses". Ordered by started_at because a run that died
 * between logCronStart and logCronEnd never got a finished_at.
 */
export async function lastFailurePerCron(
  supabase: SupabaseClient,
  cron_names: string[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  for (const name of cron_names) {
    const { data } = await supabase
      .from("cron_runs")
      .select("started_at, finished_at")
      .eq("cron_name", name)
      .eq("status", "failed")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const row = data as { started_at?: string; finished_at?: string | null } | null
    out[name] = row ? (row.finished_at ?? row.started_at ?? null) : null
  }
  return out
}
