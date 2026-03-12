import type { ProgramSkeleton } from "@/lib/ai/types"
import type { SplitType } from "@/types/database"

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface WeekBalance {
  week: number
  phase: string
  push: number
  pull: number
  squat: number
  hinge: number
  lunge: number
  carry: number
  rotation: number
  isometric: number
  locomotion: number
  ratio: number // push:pull ratio (>1 = push dominant, <1 = pull dominant, 0 = no data)
  isBalanced: boolean
}

export interface SkeletonCorrection {
  type: "swap_pattern" | "add_slot" | "rebalance_muscles"
  weekNumber: number
  dayOfWeek: number
  slotId?: string
  from?: string
  to?: string
  reason: string
}

export interface BalanceReport {
  weeklyBalance: WeekBalance[]
  overallPushPullRatio: number
  isBalanced: boolean
  corrections: SkeletonCorrection[]
  summary: string
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const PATTERN_DEFAULT_MUSCLES: Record<string, string[]> = {
  push: ["chest", "shoulders", "triceps"],
  pull: ["lats", "upper_back", "biceps"],
  squat: ["quadriceps", "glutes"],
  hinge: ["hamstrings", "glutes", "lower_back"],
  lunge: ["quadriceps", "glutes", "hamstrings"],
  carry: ["core", "grip", "shoulders"],
  rotation: ["core", "obliques"],
  isometric: ["core"],
  locomotion: ["full_body"],
}

/** Slot roles in priority order — we prefer to swap lower-priority slots first */
const SWAP_PRIORITY: Record<string, number> = {
  isolation: 0,
  accessory: 1,
  secondary_compound: 2,
  cool_down: 3,
  warm_up: 4,
  primary_compound: 5, // never swap
}

// ─── Balance Analysis ───────────────────────────────────────────────────────────

function getBalanceThresholds(
  splitType: SplitType,
  isDeload: boolean
): { min: number; max: number } {
  if (isDeload) return { min: 0.5, max: 2.0 }

  switch (splitType) {
    case "full_body":
    case "upper_lower":
    case "push_pull":
      return { min: 0.8, max: 1.2 }
    case "push_pull_legs":
      // PPL is inherently split, check weekly totals with relaxed threshold
      return { min: 0.7, max: 1.3 }
    default:
      return { min: 0.7, max: 1.3 }
  }
}

function isDeloadPhase(intensityModifier: string, phase: string): boolean {
  const lower = `${intensityModifier} ${phase}`.toLowerCase()
  return lower.includes("deload") || lower.includes("recovery")
}

/**
 * Analyze push/pull and movement pattern balance across the program skeleton.
 */
export function analyzePushPullBalance(
  skeleton: ProgramSkeleton,
  splitType: SplitType
): BalanceReport {
  const weeklyBalance: WeekBalance[] = []
  const corrections: SkeletonCorrection[] = []

  let totalPush = 0
  let totalPull = 0

  for (const week of skeleton.weeks) {
    const deload = isDeloadPhase(week.intensity_modifier, week.phase)
    const thresholds = getBalanceThresholds(splitType, deload)

    const counts = {
      push: 0,
      pull: 0,
      squat: 0,
      hinge: 0,
      lunge: 0,
      carry: 0,
      rotation: 0,
      isometric: 0,
      locomotion: 0,
    }

    // Track slot details for potential corrections
    const weekSlots: {
      slotId: string
      dayOfWeek: number
      role: string
      pattern: string
    }[] = []

    for (const day of week.days) {
      for (const slot of day.slots) {
        // Skip warm-up and cool-down from balance counting
        if (slot.role === "warm_up" || slot.role === "cool_down") continue

        const pattern = slot.movement_pattern as keyof typeof counts
        if (pattern in counts) {
          counts[pattern]++
        }

        weekSlots.push({
          slotId: slot.slot_id,
          dayOfWeek: day.day_of_week,
          role: slot.role,
          pattern: slot.movement_pattern,
        })
      }
    }

    totalPush += counts.push
    totalPull += counts.pull

    const ratio =
      counts.push === 0 && counts.pull === 0
        ? 0
        : counts.pull === 0
          ? counts.push // all push, no pull
          : counts.push / counts.pull

    const isBalanced =
      ratio === 0 || (ratio >= thresholds.min && ratio <= thresholds.max)

    weeklyBalance.push({
      week: week.week_number,
      phase: week.phase,
      ...counts,
      ratio,
      isBalanced,
    })

    // Generate corrections if imbalanced (only for non-deload weeks)
    if (!isBalanced && !deload) {
      const dominant = counts.push > counts.pull ? "push" : "pull"
      const deficient = dominant === "push" ? "pull" : "push"

      // Find swappable slots — lowest priority first
      const swappable = weekSlots
        .filter((s) => s.pattern === dominant)
        .sort((a, b) => (SWAP_PRIORITY[a.role] ?? 5) - (SWAP_PRIORITY[b.role] ?? 5))

      // Only swap isolation/accessory slots, never compounds
      const candidate = swappable.find(
        (s) => s.role === "isolation" || s.role === "accessory"
      )

      if (candidate) {
        corrections.push({
          type: "swap_pattern",
          weekNumber: week.week_number,
          dayOfWeek: candidate.dayOfWeek,
          slotId: candidate.slotId,
          from: dominant,
          to: deficient,
          reason: `Week ${week.week_number} has ${counts.push} push vs ${counts.pull} pull (ratio ${ratio.toFixed(2)}) — swapping ${candidate.role} slot from ${dominant} to ${deficient}`,
        })
      }
    }
  }

  const overallRatio =
    totalPush === 0 && totalPull === 0
      ? 0
      : totalPull === 0
        ? totalPush
        : totalPush / totalPull

  const allBalanced = weeklyBalance.every((w) => w.isBalanced)

  return {
    weeklyBalance,
    overallPushPullRatio: Math.round(overallRatio * 100) / 100,
    isBalanced: allBalanced,
    corrections,
    summary: allBalanced
      ? `Program is balanced (overall push:pull ratio ${overallRatio.toFixed(2)})`
      : `Program has push/pull imbalance in ${weeklyBalance.filter((w) => !w.isBalanced).length} week(s). ${corrections.length} correction(s) suggested.`,
  }
}

// ─── Apply Corrections ──────────────────────────────────────────────────────────

/**
 * Apply balance corrections to the skeleton, returning a new skeleton (immutable).
 */
export function applyBalanceCorrections(
  skeleton: ProgramSkeleton,
  corrections: SkeletonCorrection[]
): ProgramSkeleton {
  if (corrections.length === 0) return skeleton

  const corrected = structuredClone(skeleton)

  for (const correction of corrections) {
    if (correction.type !== "swap_pattern" || !correction.slotId || !correction.to) {
      continue
    }

    for (const week of corrected.weeks) {
      if (week.week_number !== correction.weekNumber) continue
      for (const day of week.days) {
        if (day.day_of_week !== correction.dayOfWeek) continue
        for (const slot of day.slots) {
          if (slot.slot_id === correction.slotId) {
            slot.movement_pattern = correction.to as typeof slot.movement_pattern
            slot.target_muscles =
              PATTERN_DEFAULT_MUSCLES[correction.to] ?? slot.target_muscles
          }
        }
      }
    }
  }

  return corrected
}

// ─── Movement Pattern Targets ───────────────────────────────────────────────────

/**
 * Returns ideal movement pattern distribution targets per week
 * based on split type and sessions per week.
 */
export function getMovementPatternTargets(
  splitType: SplitType,
  sessionsPerWeek: number
): Record<string, { min: number; max: number }> {
  const scale = sessionsPerWeek / 3 // normalize to 3 sessions as baseline

  const base: Record<string, { min: number; max: number }> = {
    push: { min: 3, max: 5 },
    pull: { min: 3, max: 5 },
    squat: { min: 2, max: 4 },
    hinge: { min: 2, max: 3 },
    lunge: { min: 1, max: 2 },
    carry: { min: 0, max: 1 },
    rotation: { min: 1, max: 2 },
    isometric: { min: 0, max: 2 },
    locomotion: { min: 0, max: 1 },
  }

  // Scale targets by session count
  const result: Record<string, { min: number; max: number }> = {}
  for (const [pattern, target] of Object.entries(base)) {
    result[pattern] = {
      min: Math.max(1, Math.round(target.min * scale)),
      max: Math.round(target.max * scale),
    }
  }

  // Split-specific adjustments
  switch (splitType) {
    case "full_body":
      // Each session covers everything — higher minimums
      result.push.min = Math.max(result.push.min, sessionsPerWeek)
      result.pull.min = Math.max(result.pull.min, sessionsPerWeek)
      result.squat.min = Math.max(result.squat.min, Math.ceil(sessionsPerWeek * 0.7))
      result.hinge.min = Math.max(result.hinge.min, Math.ceil(sessionsPerWeek * 0.5))
      break
    case "upper_lower":
      // Balance upper patterns across upper days
      result.push.min = Math.max(result.push.min, Math.ceil(sessionsPerWeek * 0.5))
      result.pull.min = Math.max(result.pull.min, Math.ceil(sessionsPerWeek * 0.5))
      break
    case "push_pull_legs":
      // PPL naturally distributes, just ensure minimums
      result.squat.min = Math.max(result.squat.min, Math.ceil(sessionsPerWeek / 3))
      result.hinge.min = Math.max(result.hinge.min, Math.ceil(sessionsPerWeek / 3))
      break
  }

  return result
}

// ─── Formatting ─────────────────────────────────────────────────────────────────

/**
 * Format a human-readable balance report for logging/debugging.
 */
export function formatBalanceReport(report: BalanceReport): string {
  const lines: string[] = [
    `Balance Report: ${report.summary}`,
    `Overall Push:Pull Ratio: ${report.overallPushPullRatio}`,
    "",
    "Weekly Breakdown:",
  ]

  for (const wb of report.weeklyBalance) {
    const status = wb.isBalanced ? "OK" : "IMBALANCED"
    lines.push(
      `  Week ${wb.week} (${wb.phase}) [${status}]: ` +
      `push=${wb.push} pull=${wb.pull} squat=${wb.squat} hinge=${wb.hinge} ` +
      `lunge=${wb.lunge} carry=${wb.carry} rotation=${wb.rotation} ` +
      `(ratio: ${wb.ratio.toFixed(2)})`
    )
  }

  if (report.corrections.length > 0) {
    lines.push("", "Corrections:")
    for (const c of report.corrections) {
      lines.push(`  - ${c.reason}`)
    }
  }

  return lines.join("\n")
}
