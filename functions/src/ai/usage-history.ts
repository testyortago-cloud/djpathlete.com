import { getSupabase } from "../lib/supabase.js"

export type UsageRecencyMap = Map<string, number>

export async function getCoachRecentUsageFromFn(coachId: string, daysBack: number): Promise<UsageRecencyMap> {
  const supabase = getSupabase()
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("generated_exercise_usage")
    .select("exercise_id, assigned_at")
    .eq("coach_id", coachId)
    .gte("assigned_at", cutoff)
  if (error) {
    console.warn("[usage-history] getCoachRecentUsage failed:", error.message)
    return new Map()
  }
  return buildRecencyMap(data ?? [])
}

export async function getClientRecentUsageFromFn(clientId: string | null, daysBack: number): Promise<UsageRecencyMap> {
  if (!clientId) return new Map()
  const supabase = getSupabase()
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("generated_exercise_usage")
    .select("exercise_id, assigned_at")
    .eq("client_id", clientId)
    .gte("assigned_at", cutoff)
  if (error) {
    console.warn("[usage-history] getClientRecentUsage failed:", error.message)
    return new Map()
  }
  return buildRecencyMap(data ?? [])
}

export async function recordUsageFromFn(args: {
  coach_id: string
  client_id: string | null
  program_id: string
  rows: Array<{ exercise_id: string; week_number: number; day_number: number }>
}): Promise<void> {
  if (args.rows.length === 0) return
  const supabase = getSupabase()
  const payload = args.rows.map((r) => ({
    coach_id: args.coach_id,
    client_id: args.client_id,
    exercise_id: r.exercise_id,
    program_id: args.program_id,
    week_number: r.week_number,
    day_number: r.day_number,
  }))
  const { error } = await supabase.from("generated_exercise_usage").insert(payload)
  if (error) console.warn("[usage-history] recordUsage failed:", error.message)
}

function buildRecencyMap(rows: Array<{ exercise_id: string; assigned_at: string }>): UsageRecencyMap {
  const now = Date.now()
  const out = new Map<string, number>()
  for (const r of rows) {
    const daysAgo = Math.floor((now - new Date(r.assigned_at).getTime()) / (24 * 60 * 60 * 1000))
    if (!out.has(r.exercise_id) || daysAgo < (out.get(r.exercise_id) ?? Infinity)) {
      out.set(r.exercise_id, daysAgo)
    }
  }
  return out
}
