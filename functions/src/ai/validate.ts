import type {
  ProfileAnalysis,
  ProgramSkeleton,
  ExerciseAssignment,
  ValidationResult,
  ValidationIssue,
  CompressedExercise,
} from "./types.js"
import { stringSimilarity } from "string-similarity-js"

// ─── Equipment normalization ────────────────────────────────────────────────

const CANONICAL_EQUIPMENT = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "cable_machine",
  "smith_machine",
  "resistance_band",
  "pull_up_bar",
  "bench",
  "squat_rack",
  "leg_press",
  "leg_curl_machine",
  "lat_pulldown_machine",
  "rowing_machine",
  "treadmill",
  "bike",
  "box",
  "plyo_box",
  "medicine_ball",
  "stability_ball",
  "foam_roller",
  "trx",
  "landmine",
  "sled",
  "battle_ropes",
  "agility_ladder",
  "cones",
  "yoga_mat",
  "gliders",
  "wall",
  "weight_plate",
  "short_barbell",
] as const

/**
 * If the client selected this many or more equipment items, treat as "full gym"
 * and skip equipment-availability checks (still enforce avoided-equipment).
 * This threshold matches the EQUIPMENT_OPTIONS length from the questionnaire.
 */
const FULL_GYM_THRESHOLD = 25

const EQUIPMENT_ALIASES: Record<string, string> = {
  dumbbells: "dumbbell",
  barbells: "barbell",
  kettlebells: "kettlebell",
  cables: "cable_machine",
  bands: "resistance_band",
  cones_set: "cones",
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

const FUZZY_THRESHOLD = 0.7

export function normalizeEquipment(name: string): string {
  const n = name.toLowerCase().trim().replace(/\s+/g, "_")

  if (EQUIPMENT_ALIASES[n]) return EQUIPMENT_ALIASES[n]

  if (n.endsWith("s") && !n.endsWith("ss") && n.length > 3) {
    const singular = n.slice(0, -1)
    if (EQUIPMENT_ALIASES[singular]) return EQUIPMENT_ALIASES[singular]
    if ((CANONICAL_EQUIPMENT as readonly string[]).includes(singular)) return singular
  }

  if ((CANONICAL_EQUIPMENT as readonly string[]).includes(n)) return n

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
  return n
}

// ─── Program validation ─────────────────────────────────────────────────────

export function validateProgram(
  skeleton: ProgramSkeleton,
  assignment: ExerciseAssignment,
  analysis: ProfileAnalysis,
  exercises: CompressedExercise[],
  availableEquipment: string[],
  clientDifficulty: string,
  maxDifficultyScore?: number,
): ValidationResult {
  const issues: ValidationIssue[] = []
  const exerciseMap = new Map(exercises.map((e) => [e.id, e]))

  const slotMap = new Map<string, { week: number; day: number; role: string; movement: string; muscles: string[] }>()
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

  const avoidedMovements = new Set(
    analysis.exercise_constraints.filter((c) => c.type === "avoid_movement").map((c) => c.value.toLowerCase()),
  )
  const avoidedEquipment = new Set(
    analysis.exercise_constraints.filter((c) => c.type === "avoid_equipment").map((c) => c.value.toLowerCase()),
  )
  const avoidedMuscles = new Set(
    analysis.exercise_constraints.filter((c) => c.type === "avoid_muscle").map((c) => c.value.toLowerCase()),
  )
  const equipmentSet = new Set(availableEquipment.map(normalizeEquipment))
  const isFullGym = availableEquipment.length >= FULL_GYM_THRESHOLD

  // Excessive exercises per day
  for (const week of skeleton.weeks) {
    for (const day of week.days) {
      const slotCount = day.slots.length
      if (slotCount > 12) {
        issues.push({
          type: "error",
          category: "excessive_exercises",
          message: `Week ${week.week_number} ${day.label} has ${slotCount} exercises — maximum is 12.`,
        })
      } else if (slotCount > 10) {
        issues.push({
          type: "warning",
          category: "excessive_exercises",
          message: `Week ${week.week_number} ${day.label} has ${slotCount} exercises — very high.`,
        })
      }
    }
  }

  const dayExercises = new Map<string, string[]>()
  const weekMovements = new Map<number, Set<string>>()
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

    // Equipment violations (skip availability check for full gym)
    if (!isFullGym && exercise.equipment_required.length > 0 && !exercise.is_bodyweight) {
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
    for (const eq of exercise.equipment_required) {
      if (avoidedEquipment.has(normalizeEquipment(eq))) {
        issues.push({
          type: "error",
          category: "equipment_violation",
          message: `${exercise.name} uses "${eq}" which is avoided`,
          slot_ref: assigned.slot_id,
        })
      }
    }

    // Movement/injury conflicts
    if (exercise.movement_pattern && avoidedMovements.has(exercise.movement_pattern.toLowerCase())) {
      issues.push({
        type: "error",
        category: "injury_conflict",
        message: `${exercise.name} uses avoided movement "${exercise.movement_pattern}"`,
        slot_ref: assigned.slot_id,
      })
    }
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

    // Duplicate exercises
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

    // Track patterns
    if (exercise.movement_pattern) {
      const patterns = weekMovements.get(slot.week) ?? new Set()
      patterns.add(exercise.movement_pattern)
      weekMovements.set(slot.week, patterns)
    }
    if (exercise.force_type === "push") weekPush.set(slot.week, (weekPush.get(slot.week) ?? 0) + 1)
    else if (exercise.force_type === "pull") weekPull.set(slot.week, (weekPull.get(slot.week) ?? 0) + 1)

    // Difficulty mismatch
    const difficultyOrder = ["beginner", "intermediate", "advanced"]
    const clientIdx = difficultyOrder.indexOf(clientDifficulty)
    const exerciseIdx = difficultyOrder.indexOf(exercise.difficulty)
    if (clientIdx >= 0 && exerciseIdx >= 0 && exerciseIdx > clientIdx + 1) {
      issues.push({
        type: "warning",
        category: "difficulty_mismatch",
        message: `${exercise.name} (${exercise.difficulty}) may be too advanced for a ${clientDifficulty} client`,
        slot_ref: assigned.slot_id,
      })
    }

    // Difficulty score violation
    if (
      maxDifficultyScore !== undefined &&
      exercise.difficulty_score !== null &&
      exercise.difficulty_score !== undefined &&
      exercise.difficulty_score > maxDifficultyScore
    ) {
      issues.push({
        type: "error",
        category: "difficulty_score_violation",
        message: `${exercise.name} has difficulty_score ${exercise.difficulty_score} exceeding max ${maxDifficultyScore}`,
        slot_ref: assigned.slot_id,
      })
    }
  }

  // Missing patterns — skip check for recovery/deload/testing weeks
  const fundamentalPatterns = ["push", "pull", "squat", "hinge"]
  const recoveryPhases = new Set<number>()
  for (const week of skeleton.weeks) {
    const phase = week.phase.toLowerCase()
    const intensity = week.intensity_modifier.toLowerCase()
    if (
      phase.includes("recovery") ||
      phase.includes("testing") ||
      phase.includes("deload") ||
      intensity.includes("recovery")
    ) {
      recoveryPhases.add(week.week_number)
    }
  }
  for (const [week, patterns] of weekMovements) {
    if (recoveryPhases.has(week)) continue // Don't enforce pattern coverage on recovery/testing weeks
    for (const fp of fundamentalPatterns) {
      if (!patterns.has(fp)) {
        issues.push({
          type: "warning",
          category: "missing_movement_pattern",
          message: `Week ${week} is missing the "${fp}" movement pattern`,
        })
      }
    }
  }

  // Exercise diversity — ALL working exercises must rotate across weeks (< 3% repetition target)
  if (skeleton.weeks.length >= 2) {
    // Group assignments by a "slot signature" = day_of_week + order_index + role
    // ALL working roles (compounds, accessories, isolations) must rotate
    // Only warm_up and cool_down are exempt
    const slotSignatureExercises = new Map<string, Map<number, string>>()

    for (const assigned of assignment.assignments) {
      const slot = slotMap.get(assigned.slot_id)
      if (!slot) continue

      // Check working roles for rotation — non-working roles are exempt
      if (
        slot.role === "warm_up" ||
        slot.role === "cool_down" ||
        slot.role === "activation" ||
        slot.role === "conditioning" ||
        slot.role === "testing"
      )
        continue

      // Build a signature from day + order position (comparable across weeks)
      const sig = `d${slot.day}_${slot.role}_${slot.movement}`
      const weekMap = slotSignatureExercises.get(sig) ?? new Map<number, string>()
      weekMap.set(slot.week, assigned.exercise_id)
      slotSignatureExercises.set(sig, weekMap)
    }

    for (const [sig, weekMap] of slotSignatureExercises) {
      if (weekMap.size < 2) continue
      const exerciseIds = Array.from(weekMap.values())
      const uniqueExercises = new Set(exerciseIds)

      // For programs with 2+ weeks, accessories should have at least 2 different exercises
      // across the entire program for each slot signature
      if (uniqueExercises.size === 1 && exerciseIds.length >= 3) {
        const exerciseName = (() => {
          const id = exerciseIds[0]
          const ex = exerciseMap.get(id)
          return ex?.name ?? id
        })()
        issues.push({
          type: "error",
          category: "insufficient_variety",
          message: `"${exerciseName}" is used for every week in ${sig.split("_")[1]} slot (day ${sig.split("_")[0].replace("d", "")}). Accessories and isolation exercises must rotate across weeks for variety.`,
        })
      }
    }

    // Overall exercise diversity check across the whole program
    const totalSlots = assignment.assignments.length
    const uniqueExerciseIds = new Set(assignment.assignments.map((a) => a.exercise_id))
    const diversityRatio = uniqueExerciseIds.size / totalSlots

    if (totalSlots >= 10 && diversityRatio < 0.25) {
      issues.push({
        type: "error",
        category: "insufficient_variety",
        message: `Program uses only ${uniqueExerciseIds.size} unique exercises across ${totalSlots} slots (${(diversityRatio * 100).toFixed(0)}%). Minimum 25% unique exercises required for adequate variety.`,
      })
    } else if (totalSlots >= 10 && diversityRatio < 0.35) {
      issues.push({
        type: "warning",
        category: "insufficient_variety",
        message: `Program uses ${uniqueExerciseIds.size} unique exercises across ${totalSlots} slots (${(diversityRatio * 100).toFixed(0)}%). Consider more exercise variation for accessories and isolation.`,
      })
    }
  }

  // Push/pull imbalance
  for (const week of weekPush.keys()) {
    const pushCount = weekPush.get(week) ?? 0
    const pullCount = weekPull.get(week) ?? 0
    const total = pushCount + pullCount
    if (total >= 4) {
      const ratio = Math.min(pushCount, pullCount) / Math.max(pushCount, pullCount)
      if (ratio < 0.5) {
        const dominant = pushCount > pullCount ? "push" : "pull"
        issues.push({
          type: "warning",
          category: "muscle_imbalance",
          message: `Week ${week} has a ${dominant}-dominant imbalance (${pushCount} push vs ${pullCount} pull)`,
        })
      }
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
