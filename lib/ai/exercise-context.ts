import type { Exercise, MovementPattern, ForceType, Laterality } from "@/types/database"

/**
 * Compressed exercise representation for AI context.
 * Strips description, instructions, video_url, thumbnail_url, timestamps, etc.
 * This reduces token usage by ~60% while keeping all information the AI needs.
 */
export interface CompressedExercise {
  id: string
  name: string
  category: string[]
  difficulty: string
  muscle_group: string | null
  movement_pattern: MovementPattern | null
  primary_muscles: string[]
  secondary_muscles: string[]
  force_type: ForceType | null
  laterality: Laterality | null
  equipment_required: string[]
  is_bodyweight: boolean
  is_compound: boolean
}

/**
 * Strip unnecessary fields from exercises to reduce token count.
 * Keeps only the fields needed by the AI for exercise selection.
 */
export function compressExercises(exercises: Exercise[]): CompressedExercise[] {
  return exercises.map((ex) => ({
    id: ex.id,
    name: ex.name,
    category: ex.category,
    difficulty: ex.difficulty,
    muscle_group: ex.muscle_group,
    movement_pattern: ex.movement_pattern,
    primary_muscles: ex.primary_muscles,
    secondary_muscles: ex.secondary_muscles,
    force_type: ex.force_type,
    laterality: ex.laterality,
    equipment_required: ex.equipment_required,
    is_bodyweight: ex.is_bodyweight,
    is_compound: ex.is_compound,
  }))
}

/**
 * Format compressed exercises as compact JSON for inclusion in AI prompts.
 * Uses a compact representation to minimize token usage.
 */
export function formatExerciseLibrary(exercises: CompressedExercise[]): string {
  return JSON.stringify(exercises, null, 0)
}
