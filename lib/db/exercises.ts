import { createServiceRoleClient } from "@/lib/supabase"
import type { Exercise, ExerciseRelationshipType, MovementPattern, ExerciseDifficulty } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side admin routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getExercises() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true })
  if (error) throw error
  return data as Exercise[]
}

export async function getExerciseById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .eq("id", id)
    .single()
  if (error) throw error
  return data as Exercise
}

export async function createExercise(
  exercise: Omit<Exercise, "id" | "created_at" | "updated_at">
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercises")
    .insert(exercise)
    .select()
    .single()
  if (error) throw error
  return data as Exercise
}

export async function updateExercise(
  id: string,
  updates: Partial<Omit<Exercise, "id" | "created_at">>
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercises")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Exercise
}

export async function deleteExercise(id: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("exercises")
    .update({ is_active: false })
    .eq("id", id)
  if (error) throw error
}

export async function createExercisesBulk(
  exercises: Omit<Exercise, "id" | "created_at" | "updated_at">[]
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercises")
    .insert(exercises)
    .select()
  if (error) throw error
  return data as Exercise[]
}

export async function bulkUpdateExercises(
  ids: string[],
  updates: Partial<Omit<Exercise, "id" | "created_at">>
) {
  const supabase = getClient()
  const { error } = await supabase
    .from("exercises")
    .update(updates)
    .in("id", ids)
  if (error) throw error
}

export async function bulkDeleteExercises(ids: string[]) {
  const supabase = getClient()
  const { error } = await supabase
    .from("exercises")
    .update({ is_active: false })
    .in("id", ids)
  if (error) throw error
}

export interface ExerciseAIFilters {
  movement_pattern?: MovementPattern
  primary_muscles?: string[]
  equipment?: string[]
  difficulty?: ExerciseDifficulty
  is_bodyweight?: boolean
  is_compound?: boolean
}

export async function getExercisesForAI(filters?: ExerciseAIFilters) {
  const supabase = getClient()
  let query = supabase
    .from("exercises")
    .select("*")
    .eq("is_active", true)

  if (filters?.movement_pattern) {
    query = query.eq("movement_pattern", filters.movement_pattern)
  }
  if (filters?.primary_muscles && filters.primary_muscles.length > 0) {
    query = query.overlaps("primary_muscles", filters.primary_muscles)
  }
  if (filters?.equipment && filters.equipment.length > 0) {
    query = query.overlaps("equipment_required", filters.equipment)
  }
  if (filters?.difficulty) {
    query = query.eq("difficulty", filters.difficulty)
  }
  if (filters?.is_bodyweight !== undefined) {
    query = query.eq("is_bodyweight", filters.is_bodyweight)
  }
  if (filters?.is_compound !== undefined) {
    query = query.eq("is_compound", filters.is_compound)
  }

  const { data, error } = await query.order("name", { ascending: true })
  if (error) throw error
  return data as Exercise[]
}

export type ExerciseWithRelationship = Exercise & {
  relationship_type?: ExerciseRelationshipType
}

/**
 * Get alternative exercises: first from curated relationships, then backfill
 * with similar exercises matched by primary_muscles or movement_pattern.
 */
export async function getAlternativeExercises(
  exerciseId: string,
  exercise: {
    category?: string | null
    muscle_group?: string | null
    movement_pattern?: MovementPattern | null
    primary_muscles?: string[]
  }
): Promise<{ linked: ExerciseWithRelationship[]; similar: ExerciseWithRelationship[] }> {
  const supabase = getClient()

  // Step 1: Get all curated relationships — bidirectional lookup
  // Includes alternative, variation, progression, regression — all valid swap candidates
  // Forward: this exercise → related exercises
  const { data: forwardRels, error: fwdErr } = await supabase
    .from("exercise_relationships")
    .select("*, exercises!exercise_relationships_related_exercise_id_fkey(*)")
    .eq("exercise_id", exerciseId)

  if (fwdErr) throw fwdErr

  // Reverse: other exercises that list this one in their relationships
  const { data: reverseRels, error: revErr } = await supabase
    .from("exercise_relationships")
    .select("*, exercises!exercise_relationships_exercise_id_fkey(*)")
    .eq("related_exercise_id", exerciseId)

  if (revErr) throw revErr

  const seenIds = new Set<string>()
  const linked: ExerciseWithRelationship[] = []

  // Add forward relationships (related_exercise_id → the alternative)
  for (const r of forwardRels ?? []) {
    const ex = (r as Record<string, unknown>).exercises as Exercise | null
    if (!ex || seenIds.has(ex.id)) continue
    seenIds.add(ex.id)
    linked.push({
      ...ex,
      relationship_type: r.relationship_type as ExerciseRelationshipType,
    })
  }

  // Add reverse relationships (exercise_id → the one that listed us)
  for (const r of reverseRels ?? []) {
    const ex = (r as Record<string, unknown>).exercises as Exercise | null
    if (!ex || seenIds.has(ex.id)) continue
    seenIds.add(ex.id)
    linked.push({
      ...ex,
      relationship_type: r.relationship_type as ExerciseRelationshipType,
    })
  }

  // Step 2: If fewer than 5 linked, backfill with similar exercises
  // Scoped to same category + muscle_group (strength stays strength, no agility drills for squats)
  const similar: ExerciseWithRelationship[] = []
  if (linked.length < 5 && exercise.muscle_group) {
    const excludeIds = new Set([exerciseId, ...linked.map((e) => e.id)])

    let query = supabase
      .from("exercises")
      .select("*")
      .eq("is_active", true)
      .eq("muscle_group", exercise.muscle_group)
      .neq("id", exerciseId)
      .order("name", { ascending: true })

    if (exercise.category) {
      query = query.eq("category", exercise.category)
    }

    // Further narrow by primary_muscles or movement_pattern when available
    if (exercise.primary_muscles && exercise.primary_muscles.length > 0) {
      query = query.overlaps("primary_muscles", exercise.primary_muscles)
    } else if (exercise.movement_pattern) {
      query = query.eq("movement_pattern", exercise.movement_pattern)
    }

    const { data: candidates, error: simErr } = await query
    if (simErr) throw simErr

    for (const candidate of candidates ?? []) {
      if (excludeIds.has(candidate.id)) continue
      similar.push(candidate as ExerciseWithRelationship)
      if (linked.length + similar.length >= 10) break
    }
  }

  return { linked, similar }
}
