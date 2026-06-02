import type { AssignedExercise, CompressedExercise, ExerciseSlot, ProgramWeek } from "./types.js"
import { scoreExerciseForSlot } from "./exercise-filter.js"

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
  /** Flat set of exercise IDs in variety (non-anchor) roles — for hard candidate pruning. */
  excluded_exercise_ids: Set<string>
  prompt_text: string
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const MAX_REPETITION_SCORE = 0.05
/** Only warm-up/cool-down repeat every week — compounds must rotate too */
const ANCHOR_ROLES = new Set(["warm_up", "cool_down"])
/** ALL working exercise roles must vary across weeks */
const VARIETY_ROLES = new Set(["primary_compound", "secondary_compound", "accessory", "isolation"])

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
  existingExercises: {
    exercise_id: string
    exercise_name: string
    week_number: number
    role?: string
    slot_group?: string
  }[],
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
      lines.push("WARM-UP/COOL-DOWN ANCHORS (may reuse these):")
      for (const [id, name] of anchor_exercises) {
        lines.push(`  - ${name} (${id})`)
      }
      lines.push("")
    }

    if (used_accessory_exercises.size > 0) {
      lines.push(
        "EXERCISES ALREADY USED — MUST choose DIFFERENT exercises for ALL working slots (compounds, accessories, isolations):",
      )
      for (const [groupKey, exerciseIds] of used_accessory_exercises) {
        lines.push(`  ${groupKey}:`)
        for (const id of exerciseIds) {
          const match = existingExercises.find((e) => e.exercise_id === id)
          lines.push(`    - AVOID: ${match?.exercise_name ?? id} (${id})`)
        }
      }
      lines.push("")
    }

    lines.push(`Total unique exercises used so far: ${exercise_week_map.size}`)
    lines.push("")
    lines.push("RULES FOR USING THIS CONTEXT:")
    lines.push(
      "- EVERY working exercise (compounds, accessories, isolations) MUST be different each week. Target < 3% repetition.",
    )
    lines.push("- For compound slots: pick a DIFFERENT exercise that trains the same movement pattern and muscles.")
    lines.push(
      "  Example: Week 1 Barbell Back Squat → Week 2 Front Squat → Week 3 Goblet Squat (all squat pattern, all quads/glutes)",
    )
    lines.push("  Example: Week 1 Barbell Bench Press → Week 2 Dumbbell Bench Press → Week 3 Incline Barbell Press")
    lines.push("- For accessory/isolation slots: pick a DIFFERENT exercise. Vary by equipment, angle, or stance.")
    lines.push("- CRITICAL: Alternatives MUST still match the slot's movement_pattern, target_muscles, and role.")
    lines.push(
      "  Do NOT pick a random exercise just to avoid repetition — the alternative must serve the same training purpose.",
    )
    lines.push("- Only warm-up and cool-down exercises may repeat across weeks.")
    lines.push(
      "- If the exercise library has NO suitable alternatives, you MAY reuse but MUST explain why in substitution_notes.",
    )
    lines.push("")
  }

  const excluded_exercise_ids = new Set<string>()
  for (const idSet of used_accessory_exercises.values()) {
    for (const id of idSet) excluded_exercise_ids.add(id)
  }

  return {
    anchor_exercises,
    used_accessory_exercises,
    exercise_week_map,
    excluded_exercise_ids,
    prompt_text: lines.join("\n"),
  }
}

// ─── Verify Generated Week Against Prior Exercises ──────────────────────────

/**
 * Verify a newly generated week's exercises against the existing program exercises.
 * Used by the week-only generator to check for excessive repetition.
 */
// ─── Build Prior Week Context from Skeleton ────────────────────────────────

/**
 * Build context from previously generated weeks (skeleton-based) to guide
 * the next week's generation. Used by the full program generator which has
 * the complete skeleton for all weeks.
 */
export function buildPriorWeekContext(priorWeeks: WeekAssignment[], allWeeks: ProgramWeek[]): PriorWeekContext {
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

    if (anchor_exercises.size > 0) {
      lines.push("WARM-UP/COOL-DOWN ANCHORS (may reuse these):")
      for (const [id, name] of anchor_exercises) {
        lines.push(`  - ${name} (${id})`)
      }
      lines.push("")
    }

    if (used_accessory_exercises.size > 0) {
      lines.push(
        "EXERCISES ALREADY USED — MUST choose DIFFERENT exercises for ALL working slots (compounds, accessories, isolations):",
      )
      for (const [groupKey, exerciseIds] of used_accessory_exercises) {
        const [role, pattern, muscles] = groupKey.split("|")
        const exerciseNames: string[] = []
        for (const id of exerciseIds) {
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
    lines.push("")
    lines.push("RULES FOR USING THIS CONTEXT:")
    lines.push(
      "- EVERY working exercise (compounds, accessories, isolations) MUST be different each week. Target < 3% repetition.",
    )
    lines.push("- For compound slots: pick a DIFFERENT exercise that trains the same movement pattern and muscles.")
    lines.push(
      "  Example: Week 1 Barbell Back Squat → Week 2 Front Squat → Week 3 Goblet Squat (all squat pattern, all quads/glutes)",
    )
    lines.push("  Example: Week 1 Barbell Bench Press → Week 2 Dumbbell Bench Press → Week 3 Incline Barbell Press")
    lines.push("- For accessory/isolation slots: pick a DIFFERENT exercise. Vary by equipment, angle, or stance.")
    lines.push("- CRITICAL: Alternatives MUST still match the slot's movement_pattern, target_muscles, and role.")
    lines.push(
      "  Do NOT pick a random exercise just to avoid repetition — the alternative must serve the same training purpose.",
    )
    lines.push("- Only warm-up and cool-down exercises may repeat across weeks.")
    lines.push(
      "- If the exercise library has NO suitable alternatives, you MAY reuse but MUST explain why in substitution_notes.",
    )
    lines.push("")
  }

  const excluded_exercise_ids = new Set<string>()
  for (const idSet of used_accessory_exercises.values()) {
    for (const id of idSet) excluded_exercise_ids.add(id)
  }

  return {
    anchor_exercises,
    used_accessory_exercises,
    exercise_week_map,
    excluded_exercise_ids,
    prompt_text: lines.join("\n"),
  }
}

// ─── Verify a Single Week (Skeleton-based) ─────────────────────────────────

/**
 * Verify that a newly generated week doesn't excessively repeat exercises
 * from prior weeks. Uses skeleton data for role lookups.
 */
export function verifyWeekDiversity(
  currentWeek: WeekAssignment,
  priorWeeks: WeekAssignment[],
  allWeeks: ProgramWeek[],
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

  let varietySlotCount = 0
  let repeatedVarietyCount = 0

  for (const assignment of currentWeek.assignments) {
    const role = getSlotRole(assignment.slot_id, allWeeks)
    if (!role) continue

    if (ANCHOR_ROLES.has(role)) continue

    varietySlotCount++

    const priorWeekNums = priorContext.exercise_week_map.get(assignment.exercise_id)
    if (priorWeekNums && priorWeekNums.length > 0) {
      repeatedVarietyCount++

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

  const repetition_score = varietySlotCount > 0 ? repeatedVarietyCount / varietySlotCount : 0

  const errorCount = issues.filter((i) => i.severity === "error").length
  const pass = repetition_score <= MAX_REPETITION_SCORE && errorCount === 0

  return {
    pass,
    repetition_score,
    issues,
    summary: pass
      ? varietySlotCount === 0
        ? "No variety slots to check."
        : `Week ${currentWeek.week_number}: ${repeatedVarietyCount}/${varietySlotCount} accessory/isolation repeated (${(repetition_score * 100).toFixed(0)}%) — PASS`
      : `Week ${currentWeek.week_number}: ${repeatedVarietyCount}/${varietySlotCount} accessory/isolation repeated (${(repetition_score * 100).toFixed(0)}%) — FAIL. ${errorCount} same-slot-type repetitions.`,
  }
}

// ─── Cross-Program Repetition Report ────────────────────────────────────────

export interface ProgramRepetitionReport {
  total_variety_slots: number
  unique_exercises_used: number
  repetition_score: number
  most_repeated: { name: string; count: number; weeks: number[] }[]
  pass: boolean
  summary: string
}

/**
 * Generate a full-program repetition report after all weeks are generated.
 */
export function analyzeFullProgramRepetition(
  allAssignments: WeekAssignment[],
  allWeeks: ProgramWeek[],
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

  const blockSize = totalWeeks <= 8 ? 2 : 3
  const idealUniqueCount = Math.ceil(totalVarietySlots / blockSize)
  const repetition_score = idealUniqueCount > 0 ? Math.max(0, 1 - uniqueExercisesUsed / idealUniqueCount) : 0

  const sorted = [...exerciseFrequency.values()].sort((a, b) => b.count - a.count)
  const most_repeated = sorted.slice(0, 5).filter((e) => e.count > 1)

  const pass = repetition_score <= MAX_REPETITION_SCORE

  return {
    total_variety_slots: totalVarietySlots,
    unique_exercises_used: uniqueExercisesUsed,
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

// ─── Extract Single Week from Skeleton ──────────────────────────────────────

/**
 * Extract a single week from the full skeleton to send to Agent 3.
 */
export function extractWeekSkeleton(fullSkeleton: ProgramWeek[], weekNumber: number): ProgramWeek | null {
  return fullSkeleton.find((w) => w.week_number === weekNumber) ?? null
}

// ─── Verify Generated Week Against Prior Exercises (DB-based) ───────────────

export function verifyWeekAgainstExisting(
  newAssignments: AssignedExercise[],
  newWeekSkeleton: ProgramWeek,
  priorContext: PriorWeekContext,
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
        severity: isGroupRepeat ? "error" : isAnyPriorUse ? "warning" : "warning",
        message: isGroupRepeat
          ? `${assignment.exercise_name} was already used for the same slot type in week(s) ${priorWeekNums.join(", ")}. Choose a different exercise.`
          : `${assignment.exercise_name} was used in week(s) ${priorWeekNums.join(", ")}. Consider using a different exercise for variety.`,
      })
    }
  }

  const repetition_score = varietySlotCount > 0 ? repeatedVarietyCount / varietySlotCount : 0

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

// ─── Verify Within-Week Duplicates ──────────────────────────────────────────

export interface WithinWeekDuplicateIssue {
  exercise_id: string
  exercise_name: string
  slot_ids: string[]
  days: number[]
  severity: "error"
  message: string
}

export interface WithinWeekVerificationResult {
  pass: boolean
  issues: WithinWeekDuplicateIssue[]
  summary: string
}

/**
 * Verify that the new week's assignments contain no exercise_id used more
 * than once — within a single day OR across multiple days of the same week.
 *
 * The selector prompt forbids both, but it's only text guidance; without
 * programmatic verification the AI sometimes ignores it. Any duplicate is
 * surfaced as an error so the retry loop can fix it.
 *
 * Warm-up / cool-down slots are exempt — those legitimately repeat (e.g.,
 * the same activation drill across days).
 */
export function verifyWithinWeekDuplicates(
  newAssignments: AssignedExercise[],
  newWeekSkeleton: ProgramWeek,
): WithinWeekVerificationResult {
  // Group assignments by exercise_id with the slots/days where they appear
  type Hit = { slot_id: string; day_of_week: number; role: string }
  const byExercise = new Map<string, { name: string; hits: Hit[] }>()

  // Build a quick lookup of day_of_week for each slot in the new week
  const slotDay = new Map<string, number>()
  for (const day of newWeekSkeleton.days) {
    for (const slot of day.slots) {
      slotDay.set(slot.slot_id, day.day_of_week)
    }
  }

  for (const a of newAssignments) {
    const slot = getSlotDetails(a.slot_id, [newWeekSkeleton])
    if (!slot) continue
    // Anchor roles (warm-up, cool-down) may legitimately repeat
    if (ANCHOR_ROLES.has(slot.role)) continue

    const day = slotDay.get(a.slot_id) ?? -1
    const bucket = byExercise.get(a.exercise_id) ?? { name: a.exercise_name, hits: [] }
    bucket.hits.push({ slot_id: a.slot_id, day_of_week: day, role: slot.role })
    byExercise.set(a.exercise_id, bucket)
  }

  const issues: WithinWeekDuplicateIssue[] = []
  for (const [exerciseId, { name, hits }] of byExercise) {
    if (hits.length < 2) continue
    const days = Array.from(new Set(hits.map((h) => h.day_of_week))).sort((a, b) => a - b)
    const sameDayCount = hits.length - days.length // hits beyond first per day
    const message =
      sameDayCount > 0
        ? `${name} appears ${hits.length}× in week ${newWeekSkeleton.week_number} (multiple times on the same day). Pick DIFFERENT exercises for each working slot — no exercise_id may appear more than once per day or per week (warm-up / cool-down excepted).`
        : `${name} appears ${hits.length}× in week ${newWeekSkeleton.week_number} (across days ${days.join(", ")}). The selector rules forbid the same exercise_id appearing on multiple working slots in the same week — pick a DIFFERENT exercise that trains the same movement pattern and muscles for each slot (e.g., vary equipment, stance, or angle).`

    issues.push({
      exercise_id: exerciseId,
      exercise_name: name,
      slot_ids: hits.map((h) => h.slot_id),
      days,
      severity: "error",
      message,
    })
  }

  const pass = issues.length === 0
  return {
    pass,
    issues,
    summary: pass
      ? `No within-week duplicates — PASS`
      : `${issues.length} within-week duplicate exercise${issues.length === 1 ? "" : "s"} found — FAIL`,
  }
}

// ─── Post-Hoc Within-Day Deduplication ──────────────────────────────────────

export interface DedupSwap {
  slot_id: string
  day_of_week: number
  from_exercise_id: string
  from_exercise_name: string
  to_exercise_id: string
  to_exercise_name: string
}

export interface DedupUnresolved {
  slot_id: string
  day_of_week: number
  exercise_id: string
  exercise_name: string
  reason: string
}

export interface DedupSwapResult {
  swapped_count: number
  swaps: DedupSwap[]
  unresolved: DedupUnresolved[]
  summary: string
}

/**
 * Enforce the no-repeat invariant after the Exercise Selector + retry loop
 * finishes. The selector's retry loop fixes most duplicates, but when retries
 * are exhausted the orchestrator otherwise accepts the bad output with a
 * warning. This is the last line of defense.
 *
 * Scope (default "week"): an exercise_id may not appear more than once anywhere
 * in the week — neither twice on one day nor across two days. Pass
 * `scope: "day"` to only collapse same-day repeats. Anchor roles (warm-up /
 * cool-down) are exempt under both scopes — they legitimately recur.
 *
 * For any in-scope collision, the later occurrence(s) are swapped for the
 * best-scoring alternative from the candidate library that:
 *   - matches the slot's movement_pattern / role / target_muscles (via
 *     scoreExerciseForSlot — same scorer used during filtering),
 *   - isn't already used elsewhere in the same scope (so the swap can't create
 *     a new duplicate),
 *   - and isn't already excluded by prior weeks (caller filters the library
 *     before passing it in).
 *
 * Mutates `newAssignments` in place. Returns a summary suitable for logging
 * and for surfacing to the coach via warnings.
 */
export function dedupAssignmentsInPlace(
  newAssignments: AssignedExercise[],
  newWeekSkeleton: ProgramWeek,
  candidateLibrary: CompressedExercise[],
  options?: {
    equipment?: string[]
    difficulty?: string
    /**
     * Dedup scope. "week" (default) forbids an exercise_id from appearing more
     * than once anywhere in the week; "day" only forbids repeats within a
     * single day. Anchor roles (warm-up / cool-down) are exempt either way.
     */
    scope?: "day" | "week"
  },
): DedupSwapResult {
  const equipment = options?.equipment ?? []
  const difficulty = options?.difficulty ?? "intermediate"
  const scope = options?.scope ?? "week"

  const slotById = new Map<string, ExerciseSlot>()
  const slotDay = new Map<string, number>()
  for (const day of newWeekSkeleton.days) {
    for (const slot of day.slots) {
      slotById.set(slot.slot_id, slot)
      slotDay.set(slot.slot_id, day.day_of_week)
    }
  }

  // Collisions and the "already used" set are tracked per scope bucket: a single
  // shared bucket for the whole week, or one bucket per day.
  const WEEK_BUCKET = -1
  const bucketFor = (day: number) => (scope === "week" ? WEEK_BUCKET : day)

  // Track every exercise_id currently committed within each bucket. Updated as
  // we perform swaps so we never re-introduce another duplicate.
  const usedInScope = new Map<number, Set<string>>()
  for (const a of newAssignments) {
    const bucket = bucketFor(slotDay.get(a.slot_id) ?? -1)
    const set = usedInScope.get(bucket) ?? new Set<string>()
    set.add(a.exercise_id)
    usedInScope.set(bucket, set)
  }

  const swaps: DedupSwap[] = []
  const unresolved: DedupUnresolved[] = []
  // First-seen exercise_id per bucket stays; later collisions get swapped.
  const seenInScope = new Map<number, Set<string>>()

  for (const a of newAssignments) {
    const slot = slotById.get(a.slot_id)
    if (!slot) continue
    // Warm-up / cool-down may legitimately repeat
    if (ANCHOR_ROLES.has(slot.role)) continue

    const day = slotDay.get(a.slot_id) ?? -1
    const bucket = bucketFor(day)
    const seen = seenInScope.get(bucket) ?? new Set<string>()

    if (!seen.has(a.exercise_id)) {
      seen.add(a.exercise_id)
      seenInScope.set(bucket, seen)
      continue
    }

    // Duplicate within scope — find the best-scoring alternative not already
    // used anywhere in this bucket.
    const used = usedInScope.get(bucket) ?? new Set<string>()
    const scored = candidateLibrary
      .filter((ex) => !used.has(ex.id))
      .map((ex) => ({ exercise: ex, score: scoreExerciseForSlot(ex, slot, equipment, difficulty) }))
      .sort((a, b) => b.score - a.score)

    // Require a positive score — guarantees at least some pattern / muscle fit.
    const best = scored.find((c) => c.score > 0)

    if (best) {
      const fromId = a.exercise_id
      const fromName = a.exercise_name
      a.exercise_id = best.exercise.id
      a.exercise_name = best.exercise.name
      const swapNote =
        scope === "week"
          ? `Auto-swapped to avoid repeating "${fromName}" elsewhere this week.`
          : `Auto-swapped to avoid duplicate of "${fromName}" on this day.`
      a.notes = a.notes ? `${a.notes} ${swapNote}` : swapNote
      used.add(best.exercise.id)
      seen.add(best.exercise.id)
      seenInScope.set(bucket, seen)
      swaps.push({
        slot_id: a.slot_id,
        day_of_week: day,
        from_exercise_id: fromId,
        from_exercise_name: fromName,
        to_exercise_id: best.exercise.id,
        to_exercise_name: best.exercise.name,
      })
    } else {
      unresolved.push({
        slot_id: a.slot_id,
        day_of_week: day,
        exercise_id: a.exercise_id,
        exercise_name: a.exercise_name,
        reason:
          scope === "week"
            ? "No suitable alternative in candidate library that isn't already used this week."
            : "No suitable alternative in candidate library that isn't already used today.",
      })
    }
  }

  const summary =
    swaps.length === 0 && unresolved.length === 0
      ? "No within-day duplicates."
      : `${swaps.length} swap${swaps.length === 1 ? "" : "s"}, ${unresolved.length} unresolved`

  return { swapped_count: swaps.length, swaps, unresolved, summary }
}
