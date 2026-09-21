import type { CompressedExercise } from "./types.js"
import { normalizeEquipment, FULL_GYM_THRESHOLD } from "./validate.js"

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
  unlockedIds?: Set<string>,
): CompressedExercise[] {
  const clientIdx = DIFFICULTY_LEVELS.indexOf(clientDifficulty as DifficultyLevel)
  if (clientIdx === -1) return exercises
  return exercises.filter((ex) => {
    // The coach named this exercise. clientDifficulty is frequently a fallback
    // guess ("beginner" whenever no profile exists), and an explicit
    // instruction outranks a guess.
    if (unlockedIds?.has(ex.id)) return true
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
  unlockedIds?: Set<string>,
): CompressedExercise[] {
  const normalized = clientDifficulty === "elite" ? "advanced" : clientDifficulty
  const clientIdx = DIFFICULTY_LEVELS.indexOf(normalized as DifficultyLevel)
  if (clientIdx === -1) return exercises

  const progressionUnlocked = weekNumber >= EARNED_PROGRESSION_START_WEEK
  const progressionMaxIdx = progressionUnlocked ? Math.min(clientIdx + 1, DIFFICULTY_LEVELS.length - 1) : clientIdx

  return exercises.filter((ex) => {
    // Runs per week inside the orchestrator loop; without this an unlocked
    // exercise would be admitted by the input filters and then pruned back out
    // of weeks 1-2.
    if (unlockedIds?.has(ex.id)) return true
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

/**
 * Hard-exclusion equipment filter — mirrors the availability check in
 * validateProgram so the candidate pool sent to the Exercise Selector can only
 * contain exercises the client can actually perform.
 *
 * - Full-gym clients (>= FULL_GYM_THRESHOLD items selected): no filtering, since
 *   the validator also skips availability checks for them. `strict` opts out of
 *   that short-circuit — see below.
 * - Exercises with no required equipment are always kept.
 * - Otherwise an exercise is kept only if EVERY required item is available
 *   (compared via normalizeEquipment, identical to the validator).
 *
 * `is_bodyweight` deliberately grants NO exemption here, though it used to.
 * The flag describes how an exercise is LOADED, not what it needs to exist:
 * 310 of the library's 420 bodyweight-flagged rows also list equipment (TRX,
 * pull-up bar, bench, cable machine). Short-circuiting on the flag let every
 * one of them past this filter, which is how a "hotel, no equipment" week
 * shipped with TRX glides, hanging leg raises and a cable-machine stretch in
 * it (2026-09-21). Pattern coverage — the reason the exemption existed — still
 * holds without it: with zero equipment the library covers push/squat/hinge/
 * lunge/rotation/isometric/locomotion. Pull has only 3 and carry has 0, which
 * is a fact about training without a bar, not a filter bug — `ensurePatternBalance`
 * and the coach-facing warnings surface it rather than papering over it.
 *
 * `strict` marks an EXPLICIT coach override rather than a profile-derived guess.
 * Ticking 25 of 31 boxes is a deliberate statement about the other 6, so the
 * full-gym short-circuit must not silently hand back the barbell.
 */
export function filterByAvailableEquipment(
  exercises: CompressedExercise[],
  availableEquipment: string[],
  unlockedIds?: Set<string>,
  strict = false,
): CompressedExercise[] {
  if (!strict && availableEquipment.length >= FULL_GYM_THRESHOLD) return exercises

  const equipmentSet = new Set(availableEquipment.map(normalizeEquipment))
  return exercises.filter((ex) => {
    // The coach named this exercise. availableEquipment is a profile guess and
    // is empty whenever no profile exists — which silently reduces the library
    // to bodyweight-only. An explicit instruction outranks that guess.
    if (unlockedIds?.has(ex.id)) return true
    if (!ex.equipment_required || ex.equipment_required.length === 0) return true
    return ex.equipment_required.every((eq) => equipmentSet.has(normalizeEquipment(eq)))
  })
}

/** Format compressed exercises as compact JSON for inclusion in AI prompts. */
export function formatExerciseLibrary(exercises: CompressedExercise[]): string {
  return JSON.stringify(exercises, null, 0)
}
