// The exercise change log: every exercise a coach takes out of, or puts into, an AI-generated program
// (migration 00296). The generator learns from it (functions/src/ai/edit-learning.ts); Settings > AI Program
// Policy shows it. Service role only; every read is by coach_id.
import { createServiceRoleClient } from "@/lib/supabase"

export type ExerciseEditAction = "removed" | "added"

export interface ExerciseEditInput {
  businessId: string
  coachId: string
  programId: string
  exerciseId: string
  action: ExerciseEditAction
  /** The removed row had a slot_role: the AI placed it. */
  aiPick: boolean
  weekNumber: number | null
  dayOfWeek: number | null
}

/**
 * Logs one change, if the program is AI-generated. Hand-built programs are the coach's own work, not a verdict
 * on the AI, so they are skipped. So is an "added" exercise that is already elsewhere in the program: the
 * builder's duplicate and copy buttons add through the same route, and a copy is not a new choice.
 * Returns whether a row was written.
 */
export async function logExerciseEdit(input: ExerciseEditInput): Promise<boolean> {
  const supabase = createServiceRoleClient()
  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("is_ai_generated, ai_generation_params")
    .eq("id", input.programId)
    .maybeSingle()
  if (programError) throw programError
  if (!program?.is_ai_generated) return false
  if (input.action === "added") {
    const { count, error: countError } = await supabase
      .from("program_exercises")
      .select("id", { count: "exact", head: true })
      .eq("program_id", input.programId)
      .eq("exercise_id", input.exerciseId)
    if (countError) throw countError
    // The row just added is one of them.
    if ((count ?? 0) > 1) return false
  }
  const clientId = (program.ai_generation_params as { request?: { client_id?: unknown } } | null)?.request?.client_id
  const { error } = await supabase.from("program_exercise_edits").insert({
    business_id: input.businessId,
    coach_id: input.coachId,
    program_id: input.programId,
    client_id: typeof clientId === "string" ? clientId : null,
    exercise_id: input.exerciseId,
    action: input.action,
    ai_pick: input.aiPick,
    week_number: input.weekNumber,
    day_of_week: input.dayOfWeek,
  })
  if (error) throw error
  return true
}

/** How far back the generator learns, and what the settings card counts. Twin: functions/src/ai/edit-learning.ts. */
export const EDIT_LEARNING_DAYS = 180

export interface ExerciseEditCount {
  exercise_id: string
  name: string
  count: number
}

export interface ExerciseEditSummary {
  /** AI picks the coach took out. */
  removed: number
  /** Exercises the coach put into AI programs. */
  added: number
  topRemoved: ExerciseEditCount[]
  topAdded: ExerciseEditCount[]
  recent: Array<{
    created_at: string
    action: ExerciseEditAction
    exercise: string
    program: string | null
    week_number: number | null
    day_of_week: number | null
  }>
}

type EditRow = {
  created_at: string
  action: ExerciseEditAction
  ai_pick: boolean
  exercise_id: string
  week_number: number | null
  day_of_week: number | null
  exercises: { name: string } | null
  programs: { name: string } | null
}

function top(rows: EditRow[], limit: number): ExerciseEditCount[] {
  const counts = new Map<string, ExerciseEditCount>()
  for (const r of rows) {
    const c = counts.get(r.exercise_id) ?? {
      exercise_id: r.exercise_id,
      name: r.exercises?.name ?? "Deleted exercise",
      count: 0,
    }
    c.count++
    counts.set(r.exercise_id, c)
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit)
}

/** The coach's changes over the learning window: the counts the generator uses, plus the latest changes. */
export function summarizeEdits(rows: EditRow[], limit = 8): ExerciseEditSummary {
  // Removing an exercise the coach added themselves is not a verdict on the AI; the generator skips it too.
  const removed = rows.filter((r) => r.action === "removed" && r.ai_pick)
  const added = rows.filter((r) => r.action === "added")
  return {
    removed: removed.length,
    added: added.length,
    topRemoved: top(removed, limit),
    topAdded: top(added, limit),
    recent: [...removed, ...added]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 20)
      .map((r) => ({
        created_at: r.created_at,
        action: r.action,
        exercise: r.exercises?.name ?? "Deleted exercise",
        program: r.programs?.name ?? null,
        week_number: r.week_number,
        day_of_week: r.day_of_week,
      })),
  }
}

export async function getExerciseEditSummary(coachId: string, now = new Date()): Promise<ExerciseEditSummary> {
  const supabase = createServiceRoleClient()
  const since = new Date(now.getTime() - EDIT_LEARNING_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from("program_exercise_edits")
    .select("created_at, action, ai_pick, exercise_id, week_number, day_of_week, exercises(name), programs(name)")
    .eq("coach_id", coachId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000)
  if (error) throw error
  return summarizeEdits((data ?? []) as unknown as EditRow[])
}
