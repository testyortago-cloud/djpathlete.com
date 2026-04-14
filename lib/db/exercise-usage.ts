import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

export interface UsageRow {
  exercise_id: string
  week_number: number
  day_number: number
}

export interface RecordUsageArgs {
  coach_id: string
  client_id: string | null
  program_id: string
  rows: UsageRow[]
}

export async function recordProgramExerciseUsage(args: RecordUsageArgs): Promise<void> {
  if (args.rows.length === 0) return
  const supabase = getClient()
  const payload = args.rows.map((r) => ({
    coach_id: args.coach_id,
    client_id: args.client_id,
    exercise_id: r.exercise_id,
    program_id: args.program_id,
    week_number: r.week_number,
    day_number: r.day_number,
  }))
  const { error } = await supabase.from("generated_exercise_usage").insert(payload)
  if (error) throw error
}

export async function getCoachRecentUsage(
  coachId: string,
  daysBack: number
): Promise<Map<string, number>> {
  const supabase = getClient()
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("generated_exercise_usage")
    .select("exercise_id, assigned_at")
    .eq("coach_id", coachId)
    .gte("assigned_at", cutoff)
    .order("assigned_at", { ascending: false })
  if (error) throw error
  return reduceToRecencyMap(data ?? [])
}

export async function getClientRecentUsage(
  clientId: string,
  daysBack: number
): Promise<Map<string, number>> {
  const supabase = getClient()
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("generated_exercise_usage")
    .select("exercise_id, assigned_at")
    .eq("client_id", clientId)
    .gte("assigned_at", cutoff)
    .order("assigned_at", { ascending: false })
  if (error) throw error
  return reduceToRecencyMap(data ?? [])
}

function reduceToRecencyMap(
  rows: Array<{ exercise_id: string; assigned_at: string }>
): Map<string, number> {
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
