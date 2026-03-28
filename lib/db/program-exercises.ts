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

export async function addExerciseToProgram(
  programExercise: Omit<ProgramExercise, "id" | "created_at">
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_exercises")
    .insert(programExercise)
    .select()
    .single()
  if (error) throw error
  return data as ProgramExercise
}

export async function removeExerciseFromProgram(id: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("program_exercises")
    .delete()
    .eq("id", id)
  if (error) throw error
}

export async function updateProgramExercise(
  id: string,
  updates: Partial<Omit<ProgramExercise, "id" | "created_at">>
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_exercises")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as ProgramExercise
}

export async function reorderExercise(
  id: string,
  newOrderIndex: number
) {
  return updateProgramExercise(id, { order_index: newOrderIndex })
}

export async function duplicateWeekExercises(
  programId: string,
  sourceWeek: number,
  targetWeek: number
) {
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

  const { data, error } = await supabase
    .from("program_exercises")
    .insert(toInsert)
    .select()
  if (error) throw error
  return data as ProgramExercise[]
}

export async function deleteWeekExercises(
  programId: string,
  weekNumber: number
) {
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
          .eq("id", ex.id)
      )
    )
  }
}

export async function deleteDayExercises(
  programId: string,
  weekNumber: number,
  dayOfWeek: number
) {
  const supabase = getClient()
  const { error } = await supabase
    .from("program_exercises")
    .delete()
    .eq("program_id", programId)
    .eq("week_number", weekNumber)
    .eq("day_of_week", dayOfWeek)
  if (error) throw error
}

export async function duplicateProgramExercises(
  sourceProgramId: string,
  targetProgramId: string
) {
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

  const { data, error } = await supabase
    .from("program_exercises")
    .insert(toInsert)
    .select()
  if (error) throw error
  return data as ProgramExercise[]
}
