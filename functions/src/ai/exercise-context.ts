import type { CompressedExercise } from "./types.js"

const DIFFICULTY_LEVELS = ["beginner", "intermediate", "advanced"] as const
type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number]

/** Threshold (inclusive) below which a higher-tier exercise becomes eligible in later weeks. */
const EARNED_PROGRESSION_SCORE_CAP = 4

/** Week number at which earned progression unlocks low-score higher-tier exercises. */
const EARNED_PROGRESSION_START_WEEK = 3

/**
 * Filter compressed exercises by max numeric difficulty score (from assessment).
 * Exercises without a score are always included.
 */
export function filterByDifficultyScore(
  exercises: CompressedExercise[],
  maxDifficultyScore?: number,
): CompressedExercise[] {
  if (maxDifficultyScore === undefined) return exercises
  return exercises.filter((ex) => {
    if (ex.difficulty_score === null || ex.difficulty_score === undefined) return true
    return ex.difficulty_score <= maxDifficultyScore
  })
}

/**
 * Hard-exclusion difficulty filter.
 * - beginner clients:    ONLY beginner exercises
 * - intermediate clients: beginner + intermediate
 * - advanced/elite:      all exercises
 * - unknown difficulty level: no filtering (graceful)
 * - exercise with unknown difficulty: always included
 */
export function filterByDifficultyLevel(
  exercises: CompressedExercise[],
  clientDifficulty: string,
): CompressedExercise[] {
  const clientIdx = DIFFICULTY_LEVELS.indexOf(clientDifficulty as DifficultyLevel)
  if (clientIdx === -1) return exercises
  return exercises.filter((ex) => {
    const exIdx = DIFFICULTY_LEVELS.indexOf(ex.difficulty as DifficultyLevel)
    if (exIdx === -1) return true
    return exIdx <= clientIdx
  })
}

/**
 * Earned-progression filter layered on top of experience-level filtering.
 *
 * Base rule matches filterByDifficultyLevel. Additionally, from
 * EARNED_PROGRESSION_START_WEEK onward, low-score (<= EARNED_PROGRESSION_SCORE_CAP)
 * exercises from ONE tier above the client's level become eligible.
 *
 * - beginner, weeks 1-2: only beginner exercises.
 * - beginner, week 3+:   beginner + intermediate with score <= 4. Advanced NEVER.
 * - intermediate, weeks 1-2: beginner + intermediate.
 * - intermediate, week 3+:   + advanced with score <= 4.
 * - advanced/elite: no restrictions at any week.
 *
 * Exercises without a difficulty_score are treated conservatively: they are
 * included only if their tier is already in-bounds (not via progression).
 */
export function filterByProgressionPhase(
  exercises: CompressedExercise[],
  clientDifficulty: string,
  weekNumber: number,
): CompressedExercise[] {
  const normalized = clientDifficulty === "elite" ? "advanced" : clientDifficulty
  const clientIdx = DIFFICULTY_LEVELS.indexOf(normalized as DifficultyLevel)
  if (clientIdx === -1) return exercises

  const progressionUnlocked = weekNumber >= EARNED_PROGRESSION_START_WEEK
  const progressionMaxIdx = progressionUnlocked ? Math.min(clientIdx + 1, DIFFICULTY_LEVELS.length - 1) : clientIdx

  return exercises.filter((ex) => {
    const exIdx = DIFFICULTY_LEVELS.indexOf(ex.difficulty as DifficultyLevel)
    if (exIdx === -1) return true

    if (exIdx <= clientIdx) return true

    if (exIdx === progressionMaxIdx && progressionUnlocked) {
      if (ex.difficulty_score === null || ex.difficulty_score === undefined) return false
      return ex.difficulty_score <= EARNED_PROGRESSION_SCORE_CAP
    }

    return false
  })
}

/** Format compressed exercises as compact JSON for inclusion in AI prompts. */
export function formatExerciseLibrary(exercises: CompressedExercise[]): string {
  return JSON.stringify(exercises, null, 0)
}
