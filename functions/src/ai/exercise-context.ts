import type { CompressedExercise } from "./types.js"

const DIFFICULTY_LEVELS = ["beginner", "intermediate", "advanced"] as const

/**
 * Filter compressed exercises by max difficulty score (numeric, from assessment).
 */
export function filterByDifficultyScore(
  exercises: CompressedExercise[],
  maxDifficultyScore?: number
): CompressedExercise[] {
  if (maxDifficultyScore === undefined) return exercises
  return exercises.filter((ex) => {
    // Include exercises without a difficulty_score — only exclude those explicitly above the max
    if (ex.difficulty_score === null || ex.difficulty_score === undefined) return true
    return ex.difficulty_score <= maxDifficultyScore
  })
}

/**
 * Filter exercises by text difficulty level (beginner/intermediate/advanced).
 * Removes exercises that are MORE than one level above the client's level.
 * e.g., a beginner client will NOT see "advanced" exercises, but WILL see "intermediate".
 * An intermediate client sees everything.
 * This ensures beginners never get advanced exercises even without an assessment.
 */
export function filterByDifficultyLevel(
  exercises: CompressedExercise[],
  clientDifficulty: string
): CompressedExercise[] {
  const clientIdx = DIFFICULTY_LEVELS.indexOf(clientDifficulty as (typeof DIFFICULTY_LEVELS)[number])
  if (clientIdx === -1) return exercises // unknown level, don't filter
  // Allow exercises up to one level above client
  const maxIdx = Math.min(clientIdx + 1, DIFFICULTY_LEVELS.length - 1)
  return exercises.filter((ex) => {
    const exIdx = DIFFICULTY_LEVELS.indexOf(ex.difficulty as (typeof DIFFICULTY_LEVELS)[number])
    if (exIdx === -1) return true // unknown difficulty, include
    return exIdx <= maxIdx
  })
}

/**
 * Format compressed exercises as compact JSON for inclusion in AI prompts.
 */
export function formatExerciseLibrary(exercises: CompressedExercise[]): string {
  return JSON.stringify(exercises, null, 0)
}
