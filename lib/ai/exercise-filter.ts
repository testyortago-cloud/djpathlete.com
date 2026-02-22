import type { CompressedExercise } from "@/lib/ai/exercise-context"
import type { ExerciseSlot, ProgramSkeleton, ProfileAnalysis } from "@/lib/ai/types"

// ─── Related movement patterns ──────────────────────────────────────────────

const RELATED_PATTERNS: Record<string, string[]> = {
  push: ["isometric"],
  pull: ["isometric"],
  squat: ["lunge", "isometric"],
  hinge: ["pull", "isometric"],
  lunge: ["squat"],
  carry: ["isometric"],
  rotation: ["isometric"],
  isometric: ["push", "pull", "squat", "hinge"],
  locomotion: ["carry"],
}

// ─── Jaccard similarity for string arrays ────────────────────────────────────

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const setA = new Set(a.map((s) => s.toLowerCase()))
  const setB = new Set(b.map((s) => s.toLowerCase()))
  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ─── Difficulty distance ─────────────────────────────────────────────────────

const DIFFICULTY_ORDER = ["beginner", "intermediate", "advanced"] as const

function difficultyDistance(a: string, b: string): number {
  const idxA = DIFFICULTY_ORDER.indexOf(a as (typeof DIFFICULTY_ORDER)[number])
  const idxB = DIFFICULTY_ORDER.indexOf(b as (typeof DIFFICULTY_ORDER)[number])
  if (idxA === -1 || idxB === -1) return 2
  return Math.abs(idxA - idxB)
}

// ─── Score a single exercise against a slot ──────────────────────────────────

export function scoreExerciseForSlot(
  exercise: CompressedExercise,
  slot: ExerciseSlot,
  equipment: string[],
  difficulty: string
): number {
  let score = 0

  // Movement pattern match (40pts exact, 20pts related)
  if (exercise.movement_pattern === slot.movement_pattern) {
    score += 40
  } else if (
    exercise.movement_pattern &&
    RELATED_PATTERNS[slot.movement_pattern]?.includes(exercise.movement_pattern)
  ) {
    score += 20
  }

  // Muscle overlap (30pts max, Jaccard-weighted)
  const allExerciseMuscles = [...exercise.primary_muscles, ...exercise.secondary_muscles]
  score += Math.round(jaccard(allExerciseMuscles, slot.target_muscles) * 30)

  // Equipment available (20pts)
  const equipmentSet = new Set(equipment.map((e) => e.toLowerCase()))
  if (exercise.is_bodyweight) {
    score += 20
  } else if (
    exercise.equipment_required.length === 0 ||
    exercise.equipment_required.every((eq) => equipmentSet.has(eq.toLowerCase()))
  ) {
    score += 20
  }

  // Difficulty match (10pts exact, 5pts adjacent)
  const dist = difficultyDistance(exercise.difficulty, difficulty)
  if (dist === 0) score += 10
  else if (dist === 1) score += 5

  // Role bonus (5pts) — compound in compound slot, isolation in isolation slot
  const isCompoundSlot = slot.role === "primary_compound" || slot.role === "secondary_compound"
  const isIsolationSlot = slot.role === "isolation" || slot.role === "accessory"
  if (isCompoundSlot && exercise.is_compound) score += 5
  if (isIsolationSlot && !exercise.is_compound) score += 5

  return score
}

// ─── Group key for deduplicating slot requirements ───────────────────────────

function slotGroupKey(slot: ExerciseSlot): string {
  const muscles = [...slot.target_muscles].sort().join(",")
  return `${slot.movement_pattern}|${muscles}`
}

// ─── Score and filter the full library ────────────────────────────────────────

const MIN_EXERCISES = 15
const MAX_EXERCISES = 40

export function scoreAndFilterExercises(
  exercises: CompressedExercise[],
  skeleton: ProgramSkeleton,
  equipment: string[],
  analysis: ProfileAnalysis
): CompressedExercise[] {
  // Determine difficulty from analysis
  const difficulty =
    analysis.training_age_category === "novice"
      ? "beginner"
      : analysis.training_age_category === "elite"
        ? "advanced"
        : analysis.training_age_category

  // Collect all unique slot groups
  const slotGroups = new Map<string, ExerciseSlot>()
  for (const week of skeleton.weeks) {
    for (const day of week.days) {
      for (const slot of day.slots) {
        const key = slotGroupKey(slot)
        if (!slotGroups.has(key)) {
          slotGroups.set(key, slot)
        }
      }
    }
  }

  // Score each exercise against all groups, keep the max score
  const exerciseMaxScores = new Map<string, number>()

  for (const exercise of exercises) {
    let maxScore = 0
    for (const slot of slotGroups.values()) {
      const score = scoreExerciseForSlot(exercise, slot, equipment, difficulty)
      if (score > maxScore) maxScore = score
    }
    exerciseMaxScores.set(exercise.id, maxScore)
  }

  // Sort by score descending
  const sorted = [...exercises].sort((a, b) => {
    const scoreA = exerciseMaxScores.get(a.id) ?? 0
    const scoreB = exerciseMaxScores.get(b.id) ?? 0
    return scoreB - scoreA
  })

  // Take top exercises, respecting min/max bounds
  const cutoff = Math.min(MAX_EXERCISES, sorted.length)
  const filtered = sorted.slice(0, cutoff)

  // Safety: if result is too small, return all
  if (filtered.length < MIN_EXERCISES) {
    return exercises
  }

  return filtered
}
