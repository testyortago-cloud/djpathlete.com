import type {
  ProfileAnalysis,
  ProgramSkeleton,
  ExerciseAssignment,
  ValidationResult,
  ValidationIssue,
} from "@/lib/ai/types"
import type { CompressedExercise } from "@/lib/ai/exercise-context"
import { stringSimilarity } from "string-similarity-js"

/**
 * Normalize equipment names to handle singular/plural mismatches and common aliases.
 * Both the client questionnaire options ("dumbbell") and exercise DB values ("dumbbells")
 * get normalized to the same canonical form for comparison.
 *
 * Uses a 3-layer approach:
 * 1. Direct alias map lookup
 * 2. Plural stripping + alias re-check
 * 3. Fuzzy match against canonical names (string-similarity-js)
 */

const CANONICAL_EQUIPMENT = [
  "barbell", "dumbbell", "kettlebell", "cable_machine", "smith_machine",
  "resistance_band", "pull_up_bar", "bench", "squat_rack", "leg_press",
  "leg_curl_machine", "lat_pulldown_machine", "rowing_machine", "treadmill",
  "bike", "box", "plyo_box", "medicine_ball", "stability_ball", "foam_roller",
  "trx", "landmine", "sled", "battle_ropes", "agility_ladder", "cones", "yoga_mat",
] as const

const EQUIPMENT_ALIASES: Record<string, string> = {
  // Plural -> singular
  dumbbells: "dumbbell",
  barbells: "barbell",
  kettlebells: "kettlebell",
  cables: "cable_machine",
  bands: "resistance_band",
  cones_set: "cones",
  // Short names / common variations
  cable: "cable_machine",
  cable_machine: "cable_machine",
  db: "dumbbell",
  bb: "barbell",
  kb: "kettlebell",
  pull_up: "pull_up_bar",
  pullup_bar: "pull_up_bar",
  pullup: "pull_up_bar",
  chin_up_bar: "pull_up_bar",
  chinup_bar: "pull_up_bar",
  resistance_bands: "resistance_band",
  band: "resistance_band",
  battle_rope: "battle_ropes",
  plyo: "plyo_box",
  med_ball: "medicine_ball",
  swiss_ball: "stability_ball",
  exercise_ball: "stability_ball",
  smith: "smith_machine",
  lat_pulldown: "lat_pulldown_machine",
  leg_curl: "leg_curl_machine",
  leg_press_machine: "leg_press",
  rower: "rowing_machine",
  erg: "rowing_machine",
  treadmills: "treadmill",
  bikes: "bike",
  boxes: "box",
  mat: "yoga_mat",
  foam_rollers: "foam_roller",
  sleds: "sled",
  agility_ladders: "agility_ladder",
}

/** Minimum similarity score (0-1) to accept a fuzzy match */
const FUZZY_THRESHOLD = 0.7

export function normalizeEquipment(name: string): string {
  const n = name.toLowerCase().trim().replace(/\s+/g, "_")

  // Layer 1: Direct alias match
  if (EQUIPMENT_ALIASES[n]) return EQUIPMENT_ALIASES[n]

  // Layer 2: Strip trailing 's' for plural normalization, then re-check alias
  if (n.endsWith("s") && !n.endsWith("ss") && n.length > 3) {
    const singular = n.slice(0, -1)
    if (EQUIPMENT_ALIASES[singular]) return EQUIPMENT_ALIASES[singular]
    // Check if the singular form is already canonical
    if ((CANONICAL_EQUIPMENT as readonly string[]).includes(singular)) return singular
  }

  // Check if already canonical
  if ((CANONICAL_EQUIPMENT as readonly string[]).includes(n)) return n

  // Layer 3: Fuzzy match against canonical names
  let bestMatch = ""
  let bestScore = 0
  for (const canonical of CANONICAL_EQUIPMENT) {
    const score = stringSimilarity(n, canonical)
    if (score > bestScore) {
      bestScore = score
      bestMatch = canonical
    }
  }

  if (bestScore >= FUZZY_THRESHOLD) return bestMatch

  // No match found — return as-is
  return n
}

/**
 * Code-based program validation — replaces the AI Agent 4.
 * Checks equipment violations, injury conflicts, duplicates,
 * muscle balance, difficulty mismatches, and movement pattern coverage.
 * Runs in <1ms with zero token cost.
 */
export function validateProgram(
  skeleton: ProgramSkeleton,
  assignment: ExerciseAssignment,
  analysis: ProfileAnalysis,
  exercises: CompressedExercise[],
  availableEquipment: string[],
  clientDifficulty: string,
  maxDifficultyScore?: number
): ValidationResult {
  const issues: ValidationIssue[] = []

  // Build lookups
  const exerciseMap = new Map(exercises.map((e) => [e.id, e]))

  const slotMap = new Map<
    string,
    { week: number; day: number; role: string; movement: string; muscles: string[] }
  >()
  for (const week of skeleton.weeks) {
    for (const day of week.days) {
      for (const slot of day.slots) {
        slotMap.set(slot.slot_id, {
          week: week.week_number,
          day: day.day_of_week,
          role: slot.role,
          movement: slot.movement_pattern,
          muscles: slot.target_muscles,
        })
      }
    }
  }

  // Constraint lookups
  const avoidedMovements = new Set(
    analysis.exercise_constraints
      .filter((c) => c.type === "avoid_movement")
      .map((c) => c.value.toLowerCase())
  )
  const avoidedEquipment = new Set(
    analysis.exercise_constraints
      .filter((c) => c.type === "avoid_equipment")
      .map((c) => c.value.toLowerCase())
  )
  const avoidedMuscles = new Set(
    analysis.exercise_constraints
      .filter((c) => c.type === "avoid_muscle")
      .map((c) => c.value.toLowerCase())
  )
  const equipmentSet = new Set(availableEquipment.map(normalizeEquipment))

  // ── ERROR: Excessive exercises per day (unrealistic session) ──
  for (const week of skeleton.weeks) {
    for (const day of week.days) {
      const slotCount = day.slots.length
      if (slotCount > 12) {
        issues.push({
          type: "error",
          category: "excessive_exercises",
          message: `Week ${week.week_number} ${day.label} has ${slotCount} exercises — maximum is 12 (including warm-up/cool-down). This is physically impossible in a single session.`,
        })
      } else if (slotCount > 10) {
        issues.push({
          type: "warning",
          category: "excessive_exercises",
          message: `Week ${week.week_number} ${day.label} has ${slotCount} exercises — this is very high and may not fit within the session time. Consider removing low-priority exercises.`,
        })
      }
    }
  }

  // Track per-day exercise usage and per-week patterns
  const dayExercises = new Map<string, string[]>() // "w1d1" -> [exerciseId, ...]
  const weekMovements = new Map<number, Set<string>>() // week -> set of movement patterns
  const weekPush = new Map<number, number>()
  const weekPull = new Map<number, number>()

  for (const assigned of assignment.assignments) {
    const exercise = exerciseMap.get(assigned.exercise_id)
    const slot = slotMap.get(assigned.slot_id)

    if (!exercise) {
      issues.push({
        type: "error",
        category: "missing_exercise",
        message: `Exercise ID ${assigned.exercise_id} (${assigned.exercise_name}) not found in library`,
        slot_ref: assigned.slot_id,
      })
      continue
    }

    if (!slot) continue

    const dayKey = `w${slot.week}d${slot.day}`

    // ── ERROR: Equipment violations ──
    if (exercise.equipment_required.length > 0 && !exercise.is_bodyweight) {
      for (const eq of exercise.equipment_required) {
        if (!equipmentSet.has(normalizeEquipment(eq))) {
          issues.push({
            type: "error",
            category: "equipment_violation",
            message: `${exercise.name} requires "${eq}" which is not available`,
            slot_ref: assigned.slot_id,
          })
        }
      }
    }

    // Also check avoided equipment
    for (const eq of exercise.equipment_required) {
      if (avoidedEquipment.has(normalizeEquipment(eq))) {
        issues.push({
          type: "error",
          category: "equipment_violation",
          message: `${exercise.name} uses "${eq}" which is in the avoided equipment list`,
          slot_ref: assigned.slot_id,
        })
      }
    }

    // ── ERROR: Injury / movement conflicts ──
    if (exercise.movement_pattern && avoidedMovements.has(exercise.movement_pattern.toLowerCase())) {
      issues.push({
        type: "error",
        category: "injury_conflict",
        message: `${exercise.name} uses avoided movement pattern "${exercise.movement_pattern}"`,
        slot_ref: assigned.slot_id,
      })
    }

    // Check if primary muscles hit an avoided muscle
    for (const muscle of exercise.primary_muscles) {
      if (avoidedMuscles.has(muscle.toLowerCase())) {
        issues.push({
          type: "error",
          category: "injury_conflict",
          message: `${exercise.name} targets avoided muscle "${muscle}"`,
          slot_ref: assigned.slot_id,
        })
      }
    }

    // ── ERROR: Duplicate exercises on same day ──
    const existing = dayExercises.get(dayKey) ?? []
    if (existing.includes(assigned.exercise_id)) {
      issues.push({
        type: "error",
        category: "duplicate_exercise",
        message: `${exercise.name} appears more than once on week ${slot.week} day ${slot.day}`,
        slot_ref: assigned.slot_id,
      })
    }
    dayExercises.set(dayKey, [...existing, assigned.exercise_id])

    // Track movement patterns per week
    if (exercise.movement_pattern) {
      const patterns = weekMovements.get(slot.week) ?? new Set()
      patterns.add(exercise.movement_pattern)
      weekMovements.set(slot.week, patterns)
    }

    // Track push/pull balance per week
    if (exercise.force_type === "push") {
      weekPush.set(slot.week, (weekPush.get(slot.week) ?? 0) + 1)
    } else if (exercise.force_type === "pull") {
      weekPull.set(slot.week, (weekPull.get(slot.week) ?? 0) + 1)
    }

    // ── WARNING: Difficulty mismatch (accounts for difficulty_max range) ──
    const difficultyOrder = ["beginner", "intermediate", "advanced"]
    const clientIdx = difficultyOrder.indexOf(clientDifficulty)
    const exerciseMinIdx = difficultyOrder.indexOf(exercise.difficulty)
    const exerciseMaxIdx = exercise.difficulty_max
      ? difficultyOrder.indexOf(exercise.difficulty_max)
      : exerciseMinIdx
    // If exercise has a difficulty range (min to max), it's valid for any level in that range
    // Only flag if the exercise's minimum difficulty is too far above the client
    const effectiveMaxIdx = exerciseMaxIdx >= 0 ? exerciseMaxIdx : exerciseMinIdx
    const clientInRange = clientIdx >= 0 && exerciseMinIdx >= 0 && clientIdx >= exerciseMinIdx && clientIdx <= effectiveMaxIdx
    if (clientIdx >= 0 && exerciseMinIdx >= 0 && !clientInRange && exerciseMinIdx > clientIdx + 1) {
      issues.push({
        type: "warning",
        category: "difficulty_mismatch",
        message: `${exercise.name} (${exercise.difficulty}${exercise.difficulty_max ? `-${exercise.difficulty_max}` : ""}) may be too advanced for a ${clientDifficulty} client`,
        slot_ref: assigned.slot_id,
      })
    }

    // ── ERROR: Difficulty score exceeds max (assessment constraint) ──
    if (
      maxDifficultyScore !== undefined &&
      exercise.difficulty_score !== null &&
      exercise.difficulty_score !== undefined &&
      exercise.difficulty_score > maxDifficultyScore
    ) {
      issues.push({
        type: "error",
        category: "difficulty_score_violation",
        message: `${exercise.name} has difficulty_score ${exercise.difficulty_score} which exceeds the client's max of ${maxDifficultyScore}`,
        slot_ref: assigned.slot_id,
      })
    }
  }

  // ── Missing fundamental movement patterns per week ──
  // Push and pull are errors (must be present); squat and hinge are warnings
  const fundamentalPatterns = ["push", "pull", "squat", "hinge"]
  for (const [week, patterns] of weekMovements) {
    for (const fp of fundamentalPatterns) {
      if (!patterns.has(fp)) {
        const isPushPull = fp === "push" || fp === "pull"
        issues.push({
          type: isPushPull ? "error" : "warning",
          category: "missing_movement_pattern",
          message: `Week ${week} is missing the "${fp}" movement pattern`,
        })
      }
    }
  }

  // ── ERROR: Push/pull imbalance (upgraded from warning — balance is enforced) ──
  for (const week of weekPush.keys()) {
    const pushCount = weekPush.get(week) ?? 0
    const pullCount = weekPull.get(week) ?? 0
    const total = pushCount + pullCount
    if (total >= 4) {
      const ratio = Math.min(pushCount, pullCount) / Math.max(pushCount, pullCount)
      if (ratio < 0.4) {
        // Severe imbalance (>2.5:1) — error
        const dominant = pushCount > pullCount ? "push" : "pull"
        issues.push({
          type: "error",
          category: "muscle_imbalance",
          message: `Week ${week} has a severe ${dominant}-dominant imbalance (${pushCount} push vs ${pullCount} pull exercises). Ratio must be at least 2:1.`,
        })
      } else if (ratio < 0.5) {
        // Moderate imbalance (2:1 to 2.5:1) — warning
        const dominant = pushCount > pullCount ? "push" : "pull"
        issues.push({
          type: "warning",
          category: "muscle_imbalance",
          message: `Week ${week} has a ${dominant}-dominant imbalance (${pushCount} push vs ${pullCount} pull exercises)`,
        })
      }
    }
  }

  // ── WARNING: Cross-week exercise repetition for accessory/isolation slots ──
  const varietyRoles = new Set(["accessory", "isolation"])
  const weekExercisesByRole = new Map<number, Map<string, string[]>>() // week -> (exercise_id -> [slot_ids])

  for (const assigned of assignment.assignments) {
    const slot = slotMap.get(assigned.slot_id)
    if (!slot || !varietyRoles.has(slot.role)) continue

    const weekMap = weekExercisesByRole.get(slot.week) ?? new Map<string, string[]>()
    const slotIds = weekMap.get(assigned.exercise_id) ?? []
    slotIds.push(assigned.slot_id)
    weekMap.set(assigned.exercise_id, slotIds)
    weekExercisesByRole.set(slot.week, weekMap)
  }

  // Check how many accessory/isolation exercises repeat across non-adjacent weeks
  const exerciseWeekUsage = new Map<string, number[]>() // exercise_id -> [week_numbers]
  for (const [week, exerciseMap] of weekExercisesByRole) {
    for (const exerciseId of exerciseMap.keys()) {
      const weeks = exerciseWeekUsage.get(exerciseId) ?? []
      weeks.push(week)
      exerciseWeekUsage.set(exerciseId, weeks)
    }
  }

  const totalWeeks = skeleton.weeks.length
  const blockSize = totalWeeks <= 8 ? 2 : 3
  for (const [exerciseId, weeks] of exerciseWeekUsage) {
    if (weeks.length <= blockSize) continue // Repeating within a block is fine

    // Find the exercise name from assignments
    const name = assignment.assignments.find((a) => a.exercise_id === exerciseId)?.exercise_name ?? exerciseId

    // Check if it spans more than one block
    const minWeek = Math.min(...weeks)
    const maxWeek = Math.max(...weeks)
    const spanBlocks = Math.ceil((maxWeek - minWeek + 1) / blockSize)

    if (spanBlocks > 1 && weeks.length > blockSize) {
      issues.push({
        type: "warning",
        category: "exercise_repetition",
        message: `${name} is used as accessory/isolation in ${weeks.length} weeks (${weeks.join(", ")}), spanning ${spanBlocks} rotation blocks. Consider more variety.`,
      })
    }
  }

  const errorCount = issues.filter((i) => i.type === "error").length
  const warningCount = issues.filter((i) => i.type === "warning").length
  const pass = errorCount === 0

  return {
    pass,
    issues,
    summary: pass
      ? warningCount > 0
        ? `Program passed validation with ${warningCount} warning(s).`
        : "Program passed all validation checks."
      : `Program has ${errorCount} error(s) and ${warningCount} warning(s) that need attention.`,
  }
}
