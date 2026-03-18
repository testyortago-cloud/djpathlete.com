import type { AssignedExercise, ExerciseSlot, ProgramWeek } from "@/lib/ai/types"

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
  repetition_score: number // 0 = perfect variety, 1 = all repeated
  issues: RepetitionIssue[]
  summary: string
}

export interface PriorWeekContext {
  /** Compound anchors that MUST be reused (exercise_id -> name) */
  anchor_exercises: Map<string, string>
  /** Accessory/isolation exercises already used in prior weeks, keyed by slot group */
  used_accessory_exercises: Map<string, Set<string>> // groupKey -> Set<exercise_id>
  /** All exercise IDs used in prior weeks with their week numbers */
  exercise_week_map: Map<string, number[]> // exercise_id -> [week_numbers]
  /** Formatted text for the AI prompt */
  prompt_text: string
}

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Max allowed repetition score before a week is rejected (0-1 scale) */
const MAX_REPETITION_SCORE = 0.5

/** Roles that are expected to repeat (anchors) */
const ANCHOR_ROLES = new Set(["primary_compound", "secondary_compound", "warm_up", "cool_down"])

/** Roles where repetition is a problem */
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

// ─── Build Prior Week Context ───────────────────────────────────────────────────

/**
 * Build context from previously generated weeks to guide the next week's generation.
 * This tells Agent 3 what exercises were already used so it can avoid repetition
 * for accessory/isolation slots while maintaining compound anchors.
 */
export function buildPriorWeekContext(
  priorWeeks: WeekAssignment[],
  allWeeks: ProgramWeek[]
): PriorWeekContext {
  const anchor_exercises = new Map<string, string>()
  const used_accessory_exercises = new Map<string, Set<string>>()
  const exercise_week_map = new Map<string, number[]>()

  for (const weekAssign of priorWeeks) {
    for (const assignment of weekAssign.assignments) {
      // Track all exercises by week
      const weeks = exercise_week_map.get(assignment.exercise_id) ?? []
      weeks.push(weekAssign.week_number)
      exercise_week_map.set(assignment.exercise_id, weeks)

      // Categorize by role
      const role = getSlotRole(assignment.slot_id, allWeeks)
      if (!role) continue

      if (ANCHOR_ROLES.has(role)) {
        anchor_exercises.set(assignment.exercise_id, assignment.exercise_name)
      }

      if (VARIETY_ROLES.has(role)) {
        const slot = getSlotDetails(assignment.slot_id, allWeeks)
        if (slot) {
          const groupKey = slotGroupKey(slot)
          const existing = used_accessory_exercises.get(groupKey) ?? new Set()
          existing.add(assignment.exercise_id)
          used_accessory_exercises.set(groupKey, existing)
        }
      }
    }
  }

  // Build prompt text
  const lines: string[] = []

  if (priorWeeks.length > 0) {
    lines.push("PREVIOUSLY ASSIGNED EXERCISES (from earlier weeks):")
    lines.push("")

    // Anchor exercises (must reuse)
    if (anchor_exercises.size > 0) {
      lines.push("COMPOUND ANCHORS (MUST reuse these exact exercises for matching compound slots):")
      for (const [id, name] of anchor_exercises) {
        lines.push(`  - ${name} (${id})`)
      }
      lines.push("")
    }

    // Used accessory/isolation exercises (must AVOID for variety)
    if (used_accessory_exercises.size > 0) {
      lines.push("ACCESSORY/ISOLATION EXERCISES ALREADY USED (MUST choose DIFFERENT exercises for these slot types):")
      for (const [groupKey, exerciseIds] of used_accessory_exercises) {
        const [role, pattern, muscles] = groupKey.split("|")
        const exerciseNames: string[] = []
        for (const id of exerciseIds) {
          // Find the name from prior assignments
          for (const weekAssign of priorWeeks) {
            const match = weekAssign.assignments.find((a) => a.exercise_id === id)
            if (match) {
              exerciseNames.push(`${match.exercise_name} (${id})`)
              break
            }
          }
        }
        lines.push(`  ${role} | ${pattern} | ${muscles}:`)
        for (const name of exerciseNames) {
          lines.push(`    - AVOID: ${name}`)
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

// ─── Verify a Single Week ───────────────────────────────────────────────────────

/**
 * Verify that a newly generated week doesn't excessively repeat exercises
 * from prior weeks. Anchor roles (compounds, warm-up, cool-down) are expected
 * to repeat and are excluded from the repetition score.
 */
export function verifyWeekDiversity(
  currentWeek: WeekAssignment,
  priorWeeks: WeekAssignment[],
  allWeeks: ProgramWeek[]
): WeekVerificationResult {
  if (priorWeeks.length === 0) {
    return {
      pass: true,
      repetition_score: 0,
      issues: [],
      summary: "First week — no prior context to check against.",
    }
  }

  const issues: RepetitionIssue[] = []
  const priorContext = buildPriorWeekContext(priorWeeks, allWeeks)

  // Count variety slots and how many repeat
  let varietySlotCount = 0
  let repeatedVarietyCount = 0

  for (const assignment of currentWeek.assignments) {
    const role = getSlotRole(assignment.slot_id, allWeeks)
    if (!role) continue

    // Skip anchor roles — they're supposed to repeat
    if (ANCHOR_ROLES.has(role)) continue

    varietySlotCount++

    // Check if this exercise was used in prior weeks
    const priorWeekNums = priorContext.exercise_week_map.get(assignment.exercise_id)
    if (priorWeekNums && priorWeekNums.length > 0) {
      repeatedVarietyCount++

      // Check if it's in the same slot group (same role + pattern + muscles)
      const slot = getSlotDetails(assignment.slot_id, allWeeks)
      if (slot) {
        const groupKey = slotGroupKey(slot)
        const usedInGroup = priorContext.used_accessory_exercises.get(groupKey)
        const isGroupRepeat = usedInGroup?.has(assignment.exercise_id) ?? false

        issues.push({
          exercise_id: assignment.exercise_id,
          exercise_name: assignment.exercise_name,
          slot_id: assignment.slot_id,
          repeated_in_weeks: priorWeekNums,
          role,
          severity: isGroupRepeat ? "error" : "warning",
          message: isGroupRepeat
            ? `${assignment.exercise_name} was already used for the same slot type (${groupKey}) in week(s) ${priorWeekNums.join(", ")}. Choose a different exercise.`
            : `${assignment.exercise_name} was used in week(s) ${priorWeekNums.join(", ")} in a different slot type. Acceptable but not ideal.`,
        })
      }
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
      ? varietySlotCount === 0
        ? "No variety slots to check."
        : `Week ${currentWeek.week_number}: ${repeatedVarietyCount}/${varietySlotCount} accessory/isolation exercises repeated (score: ${(repetition_score * 100).toFixed(0)}%) — PASS`
      : `Week ${currentWeek.week_number}: ${repeatedVarietyCount}/${varietySlotCount} accessory/isolation exercises repeated (score: ${(repetition_score * 100).toFixed(0)}%) — FAIL. ${errorCount} same-slot-type repetitions must be fixed.`,
  }
}

// ─── Cross-Program Repetition Report ────────────────────────────────────────────

export interface ProgramRepetitionReport {
  total_variety_slots: number
  unique_exercises_used: number
  exercise_frequency: Map<string, { name: string; count: number; weeks: number[] }>
  repetition_score: number
  most_repeated: { name: string; count: number; weeks: number[] }[]
  pass: boolean
  summary: string
}

/**
 * Generate a full-program repetition report after all weeks are generated.
 * This is the final validation gate.
 */
export function analyzeFullProgramRepetition(
  allAssignments: WeekAssignment[],
  allWeeks: ProgramWeek[]
): ProgramRepetitionReport {
  const exerciseFrequency = new Map<string, { name: string; count: number; weeks: number[] }>()
  let totalVarietySlots = 0

  for (const weekAssign of allAssignments) {
    for (const assignment of weekAssign.assignments) {
      const role = getSlotRole(assignment.slot_id, allWeeks)
      if (!role || ANCHOR_ROLES.has(role)) continue

      totalVarietySlots++

      const existing = exerciseFrequency.get(assignment.exercise_id)
      if (existing) {
        existing.count++
        if (!existing.weeks.includes(weekAssign.week_number)) {
          existing.weeks.push(weekAssign.week_number)
        }
      } else {
        exerciseFrequency.set(assignment.exercise_id, {
          name: assignment.exercise_name,
          count: 1,
          weeks: [weekAssign.week_number],
        })
      }
    }
  }

  const uniqueExercisesUsed = exerciseFrequency.size
  const totalWeeks = allAssignments.length

  // Ideal: each variety slot uses a unique exercise (within blocks of 2 weeks, repetition is OK)
  // So the "ideal" unique count is totalVarietySlots / blockSize
  const blockSize = totalWeeks <= 8 ? 2 : 3
  const idealUniqueCount = Math.ceil(totalVarietySlots / blockSize)
  const repetition_score = idealUniqueCount > 0
    ? Math.max(0, 1 - (uniqueExercisesUsed / idealUniqueCount))
    : 0

  // Find most repeated
  const sorted = [...exerciseFrequency.values()].sort((a, b) => b.count - a.count)
  const most_repeated = sorted.slice(0, 5).filter((e) => e.count > 1)

  const pass = repetition_score <= MAX_REPETITION_SCORE

  return {
    total_variety_slots: totalVarietySlots,
    unique_exercises_used: uniqueExercisesUsed,
    exercise_frequency: exerciseFrequency,
    repetition_score,
    most_repeated,
    pass,
    summary: `Program uses ${uniqueExercisesUsed} unique accessory/isolation exercises across ${totalVarietySlots} variety slots (${totalWeeks} weeks). ${
      most_repeated.length > 0
        ? `Most repeated: ${most_repeated.map((e) => `${e.name} (${e.count}x)`).join(", ")}.`
        : "Good variety."
    } Score: ${(repetition_score * 100).toFixed(0)}% — ${pass ? "PASS" : "FAIL"}`,
  }
}

// ─── Build Single-Week Skeleton ─────────────────────────────────────────────────

/**
 * Extract a single week from the full skeleton to send to Agent 3.
 * This reduces the cognitive load on the LLM and allows focused generation.
 */
export function extractWeekSkeleton(
  fullSkeleton: ProgramWeek[],
  weekNumber: number
): ProgramWeek | null {
  return fullSkeleton.find((w) => w.week_number === weekNumber) ?? null
}
