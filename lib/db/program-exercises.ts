import { createServiceRoleClient } from "@/lib/supabase"
import type { ProgramExercise } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getProgramExercises(programId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_exercises")
    .select("*, exercises(*)")
    .eq("program_id", programId)
    .order("week_number", { ascending: true })
    .order("day_of_week", { ascending: true })
    .order("order_index", { ascending: true })
  if (error) throw error
  return data
}

export async function addExerciseToProgram(programExercise: Omit<ProgramExercise, "id" | "created_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("program_exercises").insert(programExercise).select().single()
  if (error) throw error
  return data as ProgramExercise
}

export async function removeExerciseFromProgram(id: string) {
  const supabase = getClient()
  const { error } = await supabase.from("program_exercises").delete().eq("id", id)
  if (error) throw error
}

export async function updateProgramExercise(id: string, updates: Partial<Omit<ProgramExercise, "id" | "created_at">>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("program_exercises").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as ProgramExercise
}

export async function reorderExercise(id: string, newOrderIndex: number) {
  return updateProgramExercise(id, { order_index: newOrderIndex })
}

export async function duplicateWeekExercises(programId: string, sourceWeek: number, targetWeek: number) {
  const supabase = getClient()
  const { data: existing, error: fetchError } = await supabase
    .from("program_exercises")
    .select("*")
    .eq("program_id", programId)
    .eq("week_number", sourceWeek)
    .order("day_of_week")
    .order("order_index")
  if (fetchError) throw fetchError
  if (!existing || existing.length === 0) return []

  // Remove IDs and created_at, set target week
  const toInsert = existing.map((ex: ProgramExercise) => ({
    program_id: ex.program_id,
    exercise_id: ex.exercise_id,
    day_of_week: ex.day_of_week,
    week_number: targetWeek,
    order_index: ex.order_index,
    sets: ex.sets,
    reps: ex.reps,
    duration_seconds: ex.duration_seconds,
    rest_seconds: ex.rest_seconds,
    notes: ex.notes,
    rpe_target: ex.rpe_target,
    intensity_pct: ex.intensity_pct,
    tempo: ex.tempo,
    group_tag: ex.group_tag,
    technique: ex.technique,
    suggested_weight_kg: ex.suggested_weight_kg,
  }))

  const { data, error } = await supabase.from("program_exercises").insert(toInsert).select()
  if (error) throw error
  return data as ProgramExercise[]
}

export async function deleteWeekExercises(programId: string, weekNumber: number) {
  const supabase = getClient()

  // Delete all exercises in the target week
  const { error: deleteError } = await supabase
    .from("program_exercises")
    .delete()
    .eq("program_id", programId)
    .eq("week_number", weekNumber)
  if (deleteError) throw deleteError

  // Shift subsequent weeks down by 1
  const { data: laterExercises, error: fetchError } = await supabase
    .from("program_exercises")
    .select("id, week_number")
    .eq("program_id", programId)
    .gt("week_number", weekNumber)
  if (fetchError) throw fetchError

  if (laterExercises && laterExercises.length > 0) {
    await Promise.all(
      laterExercises.map((ex: { id: string; week_number: number }) =>
        supabase
          .from("program_exercises")
          .update({ week_number: ex.week_number - 1 })
          .eq("id", ex.id),
      ),
    )
  }
}

export async function deleteDayExercises(programId: string, weekNumber: number, dayOfWeek: number) {
  const supabase = getClient()
  const { error } = await supabase
    .from("program_exercises")
    .delete()
    .eq("program_id", programId)
    .eq("week_number", weekNumber)
    .eq("day_of_week", dayOfWeek)
  if (error) throw error
}

export type CopyScope = "day" | "week" | "program"

export interface CopyFromProgramArgs {
  sourceProgramId: string
  targetProgramId: string
  scope: CopyScope
  sourceWeek?: number
  sourceDay?: number
  targetWeek?: number
  targetDay?: number
  includeWeights: boolean
}

/**
 * Copy program_exercises from a source program into a target program.
 *
 * - scope='day'     → requires sourceWeek + sourceDay + targetWeek + targetDay, copies one day's exercises
 * - scope='week'    → requires sourceWeek + targetWeek, copies the whole week (all 7 days)
 * - scope='program' → copies every source week N into target week N; source weeks beyond
 *                     the target program's duration are silently skipped
 *
 * Inserts are appended after existing exercises on the target day (order_index continues from
 * the current max). When includeWeights is false, suggested_weight_kg is stripped from each row.
 *
 * Throws if the target program does not exist or if any required target week exceeds its duration.
 */
export async function copyExercisesFromProgram(args: CopyFromProgramArgs) {
  const supabase = getClient()

  const { data: targetProgram, error: targetErr } = await supabase
    .from("programs")
    .select("duration_weeks")
    .eq("id", args.targetProgramId)
    .single()
  if (targetErr) throw targetErr
  const targetDuration = (targetProgram?.duration_weeks ?? 0) as number

  let query = supabase.from("program_exercises").select("*").eq("program_id", args.sourceProgramId)
  if (args.scope === "day" || args.scope === "week") {
    if (!args.sourceWeek) throw new Error("sourceWeek is required for day/week scope")
    query = query.eq("week_number", args.sourceWeek)
  }
  if (args.scope === "day") {
    if (!args.sourceDay) throw new Error("sourceDay is required for day scope")
    query = query.eq("day_of_week", args.sourceDay)
  }
  const { data: sourceRows, error: srcErr } = await query
  if (srcErr) throw srcErr
  if (!sourceRows || sourceRows.length === 0) return [] as ProgramExercise[]

  function mapTarget(row: ProgramExercise): { week: number; day: number } | null {
    if (args.scope === "day") {
      if (!args.targetWeek || !args.targetDay) throw new Error("targetWeek and targetDay required for day scope")
      if (args.targetWeek > targetDuration) {
        throw new Error(`Target week ${args.targetWeek} exceeds target program duration (${targetDuration})`)
      }
      return { week: args.targetWeek, day: args.targetDay }
    }
    if (args.scope === "week") {
      if (!args.targetWeek) throw new Error("targetWeek required for week scope")
      if (args.targetWeek > targetDuration) {
        throw new Error(`Target week ${args.targetWeek} exceeds target program duration (${targetDuration})`)
      }
      return { week: args.targetWeek, day: row.day_of_week }
    }
    // program scope: 1:1 mapping; skip overflow weeks
    if (row.week_number > targetDuration) return null
    return { week: row.week_number, day: row.day_of_week }
  }

  // Compute next order_index per (week, day) on the target program so we append.
  const targetWeekDayPairs = new Set<string>()
  const projected: Array<{ row: ProgramExercise; week: number; day: number }> = []
  for (const row of sourceRows as ProgramExercise[]) {
    const t = mapTarget(row)
    if (!t) continue
    projected.push({ row, week: t.week, day: t.day })
    targetWeekDayPairs.add(`${t.week}:${t.day}`)
  }
  if (projected.length === 0) return [] as ProgramExercise[]

  const baseOffsets = new Map<string, number>()
  await Promise.all(
    Array.from(targetWeekDayPairs).map(async (pair) => {
      const [w, d] = pair.split(":").map(Number)
      const { data: existing, error: existErr } = await supabase
        .from("program_exercises")
        .select("order_index")
        .eq("program_id", args.targetProgramId)
        .eq("week_number", w)
        .eq("day_of_week", d)
        .order("order_index", { ascending: false })
        .limit(1)
      if (existErr) throw existErr
      const max = existing && existing.length > 0 ? (existing[0].order_index as number) : -1
      baseOffsets.set(pair, max + 1)
    }),
  )

  // Group source rows by (week, day) and re-index per group so order_index stays dense.
  const perGroupCounter = new Map<string, number>()
  const toInsert = projected
    .sort((a, b) => a.row.order_index - b.row.order_index)
    .map(({ row, week, day }) => {
      const key = `${week}:${day}`
      const offset = baseOffsets.get(key) ?? 0
      const n = perGroupCounter.get(key) ?? 0
      perGroupCounter.set(key, n + 1)
      return {
        program_id: args.targetProgramId,
        exercise_id: row.exercise_id,
        day_of_week: day,
        week_number: week,
        order_index: offset + n,
        sets: row.sets,
        reps: row.reps,
        duration_seconds: row.duration_seconds,
        rest_seconds: row.rest_seconds,
        notes: row.notes,
        rpe_target: row.rpe_target,
        intensity_pct: row.intensity_pct,
        tempo: row.tempo,
        group_tag: row.group_tag,
        technique: row.technique,
        suggested_weight_kg: args.includeWeights ? row.suggested_weight_kg : null,
      }
    })

  const { data, error } = await supabase
    .from("program_exercises")
    .insert(toInsert)
    .select("*, exercises(*)")
  if (error) throw error
  return data as (ProgramExercise & { exercises: unknown })[]
}

export async function duplicateProgramExercises(sourceProgramId: string, targetProgramId: string) {
  const supabase = getClient()
  const { data: existing, error: fetchError } = await supabase
    .from("program_exercises")
    .select("*")
    .eq("program_id", sourceProgramId)
  if (fetchError) throw fetchError
  if (!existing || existing.length === 0) return []

  const toInsert = existing.map((ex: ProgramExercise) => ({
    program_id: targetProgramId,
    exercise_id: ex.exercise_id,
    day_of_week: ex.day_of_week,
    week_number: ex.week_number,
    order_index: ex.order_index,
    sets: ex.sets,
    reps: ex.reps,
    duration_seconds: ex.duration_seconds,
    rest_seconds: ex.rest_seconds,
    notes: ex.notes,
    rpe_target: ex.rpe_target,
    intensity_pct: ex.intensity_pct,
    tempo: ex.tempo,
    group_tag: ex.group_tag,
    technique: ex.technique,
    suggested_weight_kg: ex.suggested_weight_kg,
  }))

  const { data, error } = await supabase.from("program_exercises").insert(toInsert).select()
  if (error) throw error
  return data as ProgramExercise[]
}
