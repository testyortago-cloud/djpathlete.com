import type { ExerciseSlot, ProgramSkeleton, ValidationIssue } from "@/lib/ai/types"

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface WeekRange {
  label: string // e.g., "weeks_1_2"
  slotIds: string[]
  startWeek: number
  endWeek: number
}

export interface SlotGroup {
  groupKey: string // e.g., "primary_compound|push|chest,shoulders,triceps"
  role: ExerciseSlot["role"]
  movement_pattern: string
  target_muscles: string[]
  slotIds: string[] // all slot_ids in this group across weeks
  weekRanges: WeekRange[] // which weeks should share the same exercise
}

export interface VariationRule {
  groupKey: string
  type: "must_match" | "must_differ" | "prefer_progression"
  slotIds: string[]
  reason: string
}

export interface VariationConstraints {
  groups: SlotGroup[]
  rules: VariationRule[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function slotGroupKey(slot: ExerciseSlot): string {
  const muscles = [...slot.target_muscles].sort().join(",")
  return `${slot.role}|${slot.movement_pattern}|${muscles}`
}

function isDeloadWeek(intensityModifier: string, phase: string): boolean {
  const lower = `${intensityModifier} ${phase}`.toLowerCase()
  return lower.includes("deload") || lower.includes("recovery")
}

function buildWeekRanges(
  weekSlots: Map<number, string[]>,
  blockSize: number
): WeekRange[] {
  const weeks = [...weekSlots.keys()].sort((a, b) => a - b)
  if (weeks.length === 0) return []

  const ranges: WeekRange[] = []
  let i = 0

  while (i < weeks.length) {
    const startWeek = weeks[i]
    const endIdx = Math.min(i + blockSize - 1, weeks.length - 1)
    const endWeek = weeks[endIdx]

    const slotIds: string[] = []
    for (let j = i; j <= endIdx; j++) {
      slotIds.push(...(weekSlots.get(weeks[j]) ?? []))
    }

    ranges.push({
      label: startWeek === endWeek
        ? `week_${startWeek}`
        : `weeks_${startWeek}_${endWeek}`,
      slotIds,
      startWeek,
      endWeek,
    })

    i = endIdx + 1
  }

  return ranges
}

// ─── Core ───────────────────────────────────────────────────────────────────────

/**
 * Analyze the program skeleton and produce variation constraints that
 * Agent 3 must follow when selecting exercises.
 */
export function buildVariationConstraints(
  skeleton: ProgramSkeleton
): VariationConstraints {
  const totalWeeks = skeleton.weeks.length
  const groups = new Map<string, {
    role: ExerciseSlot["role"]
    movement_pattern: string
    target_muscles: string[]
    regularWeekSlots: Map<number, string[]> // week -> slotIds (non-deload)
    deloadSlotIds: string[]
    allSlotIds: string[]
  }>()

  // Collect all slots into groups
  for (const week of skeleton.weeks) {
    const deload = isDeloadWeek(week.intensity_modifier, week.phase)
    for (const day of week.days) {
      for (const slot of day.slots) {
        const key = slotGroupKey(slot)
        if (!groups.has(key)) {
          groups.set(key, {
            role: slot.role,
            movement_pattern: slot.movement_pattern,
            target_muscles: [...slot.target_muscles].sort(),
            regularWeekSlots: new Map(),
            deloadSlotIds: [],
            allSlotIds: [],
          })
        }
        const group = groups.get(key)!
        group.allSlotIds.push(slot.slot_id)

        if (deload) {
          group.deloadSlotIds.push(slot.slot_id)
        } else {
          const existing = group.regularWeekSlots.get(week.week_number) ?? []
          existing.push(slot.slot_id)
          group.regularWeekSlots.set(week.week_number, existing)
        }
      }
    }
  }

  // Determine block size based on program length
  const blockSize = totalWeeks <= 8 ? 2 : 3

  const slotGroups: SlotGroup[] = []
  const rules: VariationRule[] = []

  for (const [key, data] of groups) {
    const isAnchor =
      data.role === "primary_compound" ||
      data.role === "secondary_compound" ||
      data.role === "warm_up" ||
      data.role === "cool_down"

    const weekRanges = buildWeekRanges(data.regularWeekSlots, blockSize)

    slotGroups.push({
      groupKey: key,
      role: data.role,
      movement_pattern: data.movement_pattern,
      target_muscles: data.target_muscles,
      slotIds: data.allSlotIds,
      weekRanges,
    })

    if (isAnchor) {
      // Anchor slots: ALL slots must use the same exercise (including deload)
      if (data.allSlotIds.length > 1) {
        rules.push({
          groupKey: key,
          type: "must_match",
          slotIds: data.allSlotIds,
          reason:
            data.role === "warm_up" || data.role === "cool_down"
              ? "Warm-up/cool-down consistency across weeks"
              : "Progressive overload anchor — same exercise across all weeks for tracking",
        })
      }
    } else {
      // Accessory/isolation: vary across blocks
      // Must match within each block
      for (const range of weekRanges) {
        if (range.slotIds.length > 1) {
          rules.push({
            groupKey: key,
            type: "must_match",
            slotIds: range.slotIds,
            reason: `Same exercise within ${range.label} for consistency`,
          })
        }
      }

      // Must differ / prefer progression between blocks
      if (weekRanges.length >= 2) {
        const ruleType = data.role === "isolation" ? "prefer_progression" : "must_differ"
        for (let i = 0; i < weekRanges.length - 1; i++) {
          const blockA = weekRanges[i]
          const blockB = weekRanges[i + 1]
          // Pick one representative slot from each block for the constraint
          if (blockA.slotIds.length > 0 && blockB.slotIds.length > 0) {
            rules.push({
              groupKey: key,
              type: ruleType,
              slotIds: [blockA.slotIds[0], blockB.slotIds[0]],
              reason:
                ruleType === "prefer_progression"
                  ? `Use a progression/harder variation in ${blockB.label} vs ${blockA.label}`
                  : `Rotate to a different exercise in ${blockB.label} for variety`,
            })
          }
        }
      }

      // Deload slots: match the first regular block's exercise
      if (data.deloadSlotIds.length > 0 && weekRanges.length > 0) {
        rules.push({
          groupKey: key,
          type: "must_match",
          slotIds: [...data.deloadSlotIds, weekRanges[0].slotIds[0]],
          reason: "Deload keeps familiar exercises from the first block",
        })
      }
    }
  }

  return { groups: slotGroups, rules }
}

// ─── Prompt Formatting ──────────────────────────────────────────────────────────

/**
 * Format variation constraints into human-readable text for Agent 3's prompt.
 */
export function formatVariationRulesForPrompt(
  constraints: VariationConstraints
): string {
  if (constraints.rules.length === 0) {
    return ""
  }

  const lines: string[] = [
    "EXERCISE VARIATION RULES (NON-NEGOTIABLE):",
    "",
  ]

  // Group rules by groupKey for readability
  const rulesByGroup = new Map<string, VariationRule[]>()
  for (const rule of constraints.rules) {
    const existing = rulesByGroup.get(rule.groupKey) ?? []
    existing.push(rule)
    rulesByGroup.set(rule.groupKey, existing)
  }

  for (const group of constraints.groups) {
    const groupRules = rulesByGroup.get(group.groupKey)
    if (!groupRules || groupRules.length === 0) continue

    lines.push(
      `Group: ${group.role} | ${group.movement_pattern} | ${group.target_muscles.join(", ")}`
    )

    for (const rule of groupRules) {
      const slotList = rule.slotIds.join(", ")
      switch (rule.type) {
        case "must_match":
          lines.push(`  - Slots [${slotList}]: MUST use the SAME exercise (${rule.reason})`)
          break
        case "must_differ":
          lines.push(`  - Slots [${slotList}]: MUST use DIFFERENT exercises (${rule.reason})`)
          break
        case "prefer_progression":
          lines.push(`  - Slots [${slotList}]: PREFER a progression/harder variation (${rule.reason})`)
          break
      }
    }

    lines.push("")
  }

  return lines.join("\n")
}

// ─── Validation ─────────────────────────────────────────────────────────────────

/**
 * Validate that Agent 3's assignments comply with the variation constraints.
 */
export function validateVariationCompliance(
  constraints: VariationConstraints,
  assignments: { slot_id: string; exercise_id: string }[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const slotToExercise = new Map<string, string>()
  for (const a of assignments) {
    slotToExercise.set(a.slot_id, a.exercise_id)
  }

  for (const rule of constraints.rules) {
    const exerciseIds = rule.slotIds
      .map((sid) => slotToExercise.get(sid))
      .filter((id): id is string => id !== undefined)

    if (exerciseIds.length < 2) continue

    switch (rule.type) {
      case "must_match": {
        const unique = new Set(exerciseIds)
        if (unique.size > 1) {
          issues.push({
            type: "error",
            category: "variation_violation",
            message: `Slots [${rule.slotIds.join(", ")}] must use the same exercise but got ${unique.size} different exercises. ${rule.reason}`,
            slot_ref: rule.slotIds[0],
          })
        }
        break
      }
      case "must_differ": {
        // Check that the representative slots from different blocks use different exercises
        const [slotA, slotB] = rule.slotIds
        const exA = slotToExercise.get(slotA)
        const exB = slotToExercise.get(slotB)
        if (exA && exB && exA === exB) {
          issues.push({
            type: "error",
            category: "variation_violation",
            message: `Slots [${slotA}] and [${slotB}] must use different exercises for rotation but both use the same exercise. ${rule.reason}`,
            slot_ref: slotA,
          })
        }
        break
      }
      case "prefer_progression": {
        const [slotA, slotB] = rule.slotIds
        const exA = slotToExercise.get(slotA)
        const exB = slotToExercise.get(slotB)
        if (exA && exB && exA === exB) {
          issues.push({
            type: "warning",
            category: "variation_preference",
            message: `Slots [${slotA}] and [${slotB}] should ideally use a progression/variation but both use the same exercise. ${rule.reason}`,
            slot_ref: slotA,
          })
        }
        break
      }
    }
  }

  return issues
}
