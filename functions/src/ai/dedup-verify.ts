import type { AssignedExercise, ExerciseSlot, ProgramWeek } from "./types.js"

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface WeekAssignment {
  week_number: number
  assignments: AssignedExercise[]
}

export interface RepetitionIssue {
  exercise_id: string
  exercise_name: string
  slot_id: string
  repeated_in_weeks: number[]
  role: string
  severity: "error" | "warning"
  message: string
}

export interface WeekVerificationResult {
  pass: boolean
  repetition_score: number
  issues: RepetitionIssue[]
  summary: string
}

export interface PriorWeekContext {
  anchor_exercises: Map<string, string>
  used_accessory_exercises: Map<string, Set<string>>
  exercise_week_map: Map<string, number[]>
  prompt_text: string
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const MAX_REPETITION_SCORE = 0.5
const ANCHOR_ROLES = new Set(["primary_compound", "secondary_compound", "warm_up", "cool_down"])
const VARIETY_ROLES = new Set(["accessory", "isolation"])

// ─── Helpers ────────────────────────────────────────────────────────────────────

function slotGroupKey(slot: ExerciseSlot): string {
  const muscles = [...slot.target_muscles].sort().join(",")
  return `${slot.role}|${slot.movement_pattern}|${muscles}`
}

function getSlotRole(slotId: string, weeks: ProgramWeek[]): string | null {
  for (const week of weeks) {
    for (const day of week.days) {
      for (const slot of day.slots) {
        if (slot.slot_id === slotId) return slot.role
      }
    }
  }
  return null
}

function getSlotDetails(slotId: string, weeks: ProgramWeek[]): ExerciseSlot | null {
  for (const week of weeks) {
    for (const day of week.days) {
      for (const slot of day.slots) {
        if (slot.slot_id === slotId) return slot
      }
    }
  }
  return null
}

// ─── Build Prior Week Context from Existing Program Exercises ───────────────

/**
 * Build dedup context from the existing program's exercises (fetched from DB).
 * This is used by the week-only generator which doesn't have the skeleton for
 * prior weeks — it uses the actual DB data instead.
 */
export function buildPriorContextFromExistingExercises(
  existingExercises: { exercise_id: string; exercise_name: string; week_number: number; role?: string; slot_group?: string }[]
): PriorWeekContext {
  const anchor_exercises = new Map<string, string>()
  const used_accessory_exercises = new Map<string, Set<string>>()
  const exercise_week_map = new Map<string, number[]>()

  for (const ex of existingExercises) {
    // Track all exercises by week
    const weeks = exercise_week_map.get(ex.exercise_id) ?? []
    if (!weeks.includes(ex.week_number)) weeks.push(ex.week_number)
    exercise_week_map.set(ex.exercise_id, weeks)

    const role = ex.role ?? "accessory"

    if (ANCHOR_ROLES.has(role)) {
      anchor_exercises.set(ex.exercise_id, ex.exercise_name)
    }

    if (VARIETY_ROLES.has(role)) {
      const groupKey = ex.slot_group ?? `${role}|unknown`
      const existing = used_accessory_exercises.get(groupKey) ?? new Set()
      existing.add(ex.exercise_id)
      used_accessory_exercises.set(groupKey, existing)
    }
  }

  // Build prompt text
  const lines: string[] = []

  if (existingExercises.length > 0) {
    lines.push("PREVIOUSLY ASSIGNED EXERCISES (from earlier weeks in this program):")
    lines.push("")

    if (anchor_exercises.size > 0) {
      lines.push("COMPOUND ANCHORS (MUST reuse these exact exercises for matching compound slots):")
      for (const [id, name] of anchor_exercises) {
        lines.push(`  - ${name} (${id})`)
      }
      lines.push("")
    }

    if (used_accessory_exercises.size > 0) {
      lines.push("ACCESSORY/ISOLATION EXERCISES ALREADY USED (MUST choose DIFFERENT exercises for these slot types):")
      for (const [groupKey, exerciseIds] of used_accessory_exercises) {
        lines.push(`  ${groupKey}:`)
        for (const id of exerciseIds) {
          // Find name from exercises
          const match = existingExercises.find((e) => e.exercise_id === id)
          lines.push(`    - AVOID: ${match?.exercise_name ?? id} (${id})`)
        }
      }
      lines.push("")
    }

    lines.push(`Total unique exercises used so far: ${exercise_week_map.size}`)
    lines.push("For accessory and isolation slots, you MUST select exercises NOT in the AVOID list above.")
    lines.push("For compound anchor slots, you MUST reuse the same exercises listed above.")
    lines.push("")
  }

  return {
    anchor_exercises,
    used_accessory_exercises,
    exercise_week_map,
    prompt_text: lines.join("\n"),
  }
}

// ─── Verify Generated Week Against Prior Exercises ──────────────────────────

/**
 * Verify a newly generated week's exercises against the existing program exercises.
 * Used by the week-only generator to check for excessive repetition.
 */
export function verifyWeekAgainstExisting(
  newAssignments: AssignedExercise[],
  newWeekSkeleton: ProgramWeek,
  priorContext: PriorWeekContext
): WeekVerificationResult {
  const issues: RepetitionIssue[] = []

  let varietySlotCount = 0
  let repeatedVarietyCount = 0

  for (const assignment of newAssignments) {
    const slot = getSlotDetails(assignment.slot_id, [newWeekSkeleton])
    if (!slot) continue

    const role = slot.role
    if (ANCHOR_ROLES.has(role)) continue

    varietySlotCount++

    const priorWeekNums = priorContext.exercise_week_map.get(assignment.exercise_id)
    if (priorWeekNums && priorWeekNums.length > 0) {
      repeatedVarietyCount++

      const groupKey = slotGroupKey(slot)
      const usedInGroup = priorContext.used_accessory_exercises.get(groupKey)
      const isGroupRepeat = usedInGroup?.has(assignment.exercise_id) ?? false

      // Also check across all accessory groups (any prior use counts)
      let isAnyPriorUse = false
      for (const [, exerciseIds] of priorContext.used_accessory_exercises) {
        if (exerciseIds.has(assignment.exercise_id)) {
          isAnyPriorUse = true
          break
        }
      }

      issues.push({
        exercise_id: assignment.exercise_id,
        exercise_name: assignment.exercise_name,
        slot_id: assignment.slot_id,
        repeated_in_weeks: priorWeekNums,
        role,
        severity: isGroupRepeat ? "error" : (isAnyPriorUse ? "warning" : "warning"),
        message: isGroupRepeat
          ? `${assignment.exercise_name} was already used for the same slot type in week(s) ${priorWeekNums.join(", ")}. Choose a different exercise.`
          : `${assignment.exercise_name} was used in week(s) ${priorWeekNums.join(", ")}. Consider using a different exercise for variety.`,
      })
    }
  }

  const repetition_score = varietySlotCount > 0
    ? repeatedVarietyCount / varietySlotCount
    : 0

  const errorCount = issues.filter((i) => i.severity === "error").length
  const pass = repetition_score <= MAX_REPETITION_SCORE && errorCount === 0

  return {
    pass,
    repetition_score,
    issues,
    summary: pass
      ? `${repeatedVarietyCount}/${varietySlotCount} accessory/isolation repeated (${(repetition_score * 100).toFixed(0)}%) — PASS`
      : `${repeatedVarietyCount}/${varietySlotCount} accessory/isolation repeated (${(repetition_score * 100).toFixed(0)}%) — FAIL. ${errorCount} same-slot-type repetitions.`,
  }
}
