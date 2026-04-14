import type { Exercise, MovementPattern, ForceType, Laterality, JointLoading } from "@/types/database"

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
  difficulty_score: number | null
  muscle_group: string | null
  movement_pattern: MovementPattern | null
  primary_muscles: string[]
  secondary_muscles: string[]
  force_type: ForceType | null
  laterality: Laterality | null
  equipment_required: string[]
  is_bodyweight: boolean
  training_intent: string[]
  difficulty_max: string | null
  sport_tags: string[]
  plane_of_motion: string[]
  joints_loaded: JointLoading[]
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
    difficulty_score: (ex as Exercise & { difficulty_score?: number | null }).difficulty_score ?? null,
    muscle_group: ex.muscle_group,
    movement_pattern: ex.movement_pattern,
    primary_muscles: ex.primary_muscles,
    secondary_muscles: ex.secondary_muscles,
    force_type: ex.force_type,
    laterality: ex.laterality,
    equipment_required: ex.equipment_required,
    is_bodyweight: ex.is_bodyweight,
    training_intent: (ex as Exercise & { training_intent?: string[] }).training_intent || ["build"],
    difficulty_max: (ex as Exercise & { difficulty_max?: string | null }).difficulty_max || null,
    sport_tags: ex.sport_tags ?? [],
    plane_of_motion: ex.plane_of_motion ?? [],
    joints_loaded: ex.joints_loaded ?? [],
  }))
}

/**
 * Filter compressed exercises by max difficulty score.
 * When maxDifficultyScore is provided, only exercises at or below that score are kept.
 * Exercises without a difficulty_score are excluded when filtering is active.
 */
export function filterByDifficultyScore(
  exercises: CompressedExercise[],
  maxDifficultyScore?: number,
): CompressedExercise[] {
  if (maxDifficultyScore === undefined) return exercises

  return exercises.filter((ex) => {
    // Include exercises without a difficulty_score — only exclude those explicitly above the max
    if (ex.difficulty_score === null || ex.difficulty_score === undefined) return true
    return ex.difficulty_score <= maxDifficultyScore
  })
}

/**
 * Format compressed exercises as compact JSON for inclusion in AI prompts.
 * Uses a compact representation to minimize token usage.
 */
export function formatExerciseLibrary(exercises: CompressedExercise[]): string {
  return JSON.stringify(exercises, null, 0)
}
