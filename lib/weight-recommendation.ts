import type { Exercise, ExerciseProgress, ExperienceLevel, Gender, ProgramExercise } from "@/types/database"

// ─── Types ──────────────────────────────────────────────────────────────────

export type Trend = "increasing" | "decreasing" | "stable" | "insufficient_data"
export type Confidence = "high" | "medium" | "low" | "none"

export interface WeightRecommendation {
  recommended_kg: number | null
  reasoning: string
  confidence: Confidence
  estimated_1rm: number | null
  last_weight_kg: number | null
  last_rpe: number | null
  trend: Trend
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Epley formula: estimate 1RM from weight and reps */
export function estimate1RM(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return weightKg
  if (reps === 1) return weightKg
  return weightKg * (1 + reps / 30)
}

/** Derive working weight from a 1RM and intensity percentage */
export function weightFromIntensity(oneRepMax: number, intensityPct: number): number {
  return Math.round((oneRepMax * intensityPct) / 100 * 2) / 2 // round to nearest 0.5
}

/** Parse reps string like "8" or "8-12" into a single number (uses the lower end) */
function parseReps(reps: string | null): number | null {
  if (!reps) return null
  const match = reps.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Get the weight increment based on exercise characteristics.
 * Upper-body / isolation → 2.5kg, lower-body compound → 5kg
 */
function getIncrement(exercise: Pick<Exercise, "movement_pattern" | "is_compound">): number {
  const lowerPatterns = ["squat", "hinge", "lunge", "carry"]
  const isLower = exercise.movement_pattern
    ? lowerPatterns.includes(exercise.movement_pattern)
    : false
  return isLower && exercise.is_compound ? 5 : 2.5
}

// ─── Starting Weight Estimation ─────────────────────────────────────────────

export interface ClientContext {
  weight_kg: number | null
  gender: Gender | null
  experience_level: ExperienceLevel | null
}

/**
 * Conservative body-weight multipliers by movement pattern.
 * These target a comfortable first-session weight (not a 1RM).
 * Male baseline — female multipliers are ~65% of male.
 */
const BW_MULTIPLIERS: Record<string, { compound: number; isolation: number }> = {
  squat:      { compound: 0.40, isolation: 0.20 },
  hinge:      { compound: 0.45, isolation: 0.20 },
  push:       { compound: 0.30, isolation: 0.10 },
  pull:       { compound: 0.25, isolation: 0.10 },
  lunge:      { compound: 0.25, isolation: 0.15 },
  carry:      { compound: 0.30, isolation: 0.20 },
  rotation:   { compound: 0.10, isolation: 0.05 },
  isometric:  { compound: 0.00, isolation: 0.00 },
  locomotion: { compound: 0.00, isolation: 0.00 },
}

const EXPERIENCE_MULTIPLIER: Record<ExperienceLevel, number> = {
  beginner: 1.0,
  intermediate: 1.25,
  advanced: 1.5,
  elite: 1.75,
}

/** Round to the nearest 2.5 kg */
function roundTo2_5(kg: number): number {
  return Math.round(kg / 2.5) * 2.5
}

/**
 * Estimate a conservative starting weight for a first-time exercise
 * based on client body weight, gender, experience, and exercise type.
 * Returns null if we can't make a reasonable estimate.
 */
function estimateStartingWeight(
  exercise: Pick<Exercise, "is_bodyweight" | "is_compound" | "movement_pattern">,
  client: ClientContext
): number | null {
  if (exercise.is_bodyweight) return null
  if (!client.weight_kg || client.weight_kg <= 0) return null

  const pattern = exercise.movement_pattern ?? "push"
  // No weight estimate for timed/isometric/locomotion patterns
  if (pattern === "isometric" || pattern === "locomotion") return null

  const multipliers = BW_MULTIPLIERS[pattern] ?? BW_MULTIPLIERS.push
  const baseMult = exercise.is_compound ? multipliers.compound : multipliers.isolation

  // Gender factor: female starts ~65% of male estimate
  const genderFactor = client.gender === "female" ? 0.65 : 1.0

  // Experience factor
  const expFactor = EXPERIENCE_MULTIPLIER[client.experience_level ?? "beginner"]

  const estimated = client.weight_kg * baseMult * genderFactor * expFactor
  const rounded = roundTo2_5(estimated)

  // Floor at 5kg for barbell exercises, 2.5kg for others
  return Math.max(exercise.is_compound ? 5 : 2.5, rounded)
}

/** Determine weight trend from recent history (newest first) */
function computeTrend(history: ExerciseProgress[]): Trend {
  const weights = history
    .filter((h) => h.weight_kg != null)
    .map((h) => h.weight_kg!)
  if (weights.length < 2) return "insufficient_data"

  // Compare most recent 3 entries (or whatever is available)
  const recent = weights.slice(0, Math.min(3, weights.length))
  const allIncreasing = recent.every((w, i) => i === 0 || w <= recent[i - 1])
  const allDecreasing = recent.every((w, i) => i === 0 || w >= recent[i - 1])

  if (allIncreasing && recent[0] > recent[recent.length - 1]) return "increasing"
  if (allDecreasing && recent[0] < recent[recent.length - 1]) return "decreasing"
  return "stable"
}

// ─── Main Recommendation ────────────────────────────────────────────────────

export function getWeightRecommendation(
  history: ExerciseProgress[],
  exercise: Pick<Exercise, "is_bodyweight" | "is_compound" | "movement_pattern" | "name">,
  prescription?: Pick<ProgramExercise, "sets" | "reps" | "intensity_pct" | "rpe_target"> | null,
  client?: ClientContext | null
): WeightRecommendation {
  // Bodyweight exercise — no weight recommendation
  if (exercise.is_bodyweight) {
    return {
      recommended_kg: null,
      reasoning: "Focus on reps and form",
      confidence: "high",
      estimated_1rm: null,
      last_weight_kg: null,
      last_rpe: null,
      trend: "stable",
    }
  }

  // No history — estimate starting weight from client profile
  if (history.length === 0) {
    const startingKg = client ? estimateStartingWeight(exercise, client) : null

    if (startingKg != null) {
      return {
        recommended_kg: startingKg,
        reasoning: `Suggested starting weight based on your profile — adjust to what feels comfortable`,
        confidence: "low",
        estimated_1rm: null,
        last_weight_kg: null,
        last_rpe: null,
        trend: "insufficient_data",
      }
    }

    return {
      recommended_kg: null,
      reasoning: "Start light, find your working weight",
      confidence: "none",
      estimated_1rm: null,
      last_weight_kg: null,
      last_rpe: null,
      trend: "insufficient_data",
    }
  }

  // Latest entry (history is sorted newest-first)
  const latest = history[0]
  const trend = computeTrend(history)

  // When set_details available, use last set's weight/RPE for progression,
  // and best set for 1RM estimate. Fall back to flat fields for old entries.
  const setDetails = latest.set_details
  const hasSetDetails = setDetails && setDetails.length > 0

  const lastWeight = hasSetDetails
    ? setDetails[setDetails.length - 1].weight_kg
    : latest.weight_kg
  const lastRpe = hasSetDetails
    ? setDetails[setDetails.length - 1].rpe
    : latest.rpe

  // Estimate 1RM: use best set if set_details available
  let estimated1rm: number | null = null
  if (hasSetDetails) {
    const best = Math.max(
      ...setDetails
        .filter((s) => (s.weight_kg ?? 0) > 0 && s.reps > 0)
        .map((s) => estimate1RM(s.weight_kg!, s.reps))
    , 0)
    estimated1rm = best > 0 ? Math.round(best) : null
  } else {
    const lastReps = parseReps(latest.reps_completed)
    estimated1rm = lastWeight && lastReps ? Math.round(estimate1RM(lastWeight, lastReps)) : null
  }

  // If prescription has intensity_pct and we have an estimated 1RM, use that
  if (prescription?.intensity_pct && estimated1rm) {
    const computed = weightFromIntensity(estimated1rm, prescription.intensity_pct)
    return {
      recommended_kg: computed,
      reasoning: `Based on estimated 1RM of ${estimated1rm}kg at ${prescription.intensity_pct}% intensity`,
      confidence: "high",
      estimated_1rm: estimated1rm,
      last_weight_kg: lastWeight,
      last_rpe: lastRpe,
      trend,
    }
  }

  // No weight logged previously
  if (lastWeight == null) {
    return {
      recommended_kg: null,
      reasoning: "Start light, find your working weight",
      confidence: "none",
      estimated_1rm: null,
      last_weight_kg: null,
      last_rpe: lastRpe,
      trend: "insufficient_data",
    }
  }

  const increment = getIncrement(exercise)

  // No RPE recorded — keep same weight, prompt for RPE
  if (lastRpe == null) {
    return {
      recommended_kg: lastWeight,
      reasoning: "Same as last session — log RPE to get better recommendations",
      confidence: "low",
      estimated_1rm: estimated1rm,
      last_weight_kg: lastWeight,
      last_rpe: null,
      trend,
    }
  }

  // RPE-based progression
  if (lastRpe <= 7) {
    return {
      recommended_kg: lastWeight + increment,
      reasoning: `Last session felt easy (RPE ${lastRpe}) — increase by ${increment}kg`,
      confidence: "high",
      estimated_1rm: estimated1rm,
      last_weight_kg: lastWeight,
      last_rpe: lastRpe,
      trend,
    }
  }

  if (lastRpe === 8) {
    return {
      recommended_kg: lastWeight,
      reasoning: `Right on target (RPE ${lastRpe}) — maintain weight`,
      confidence: "high",
      estimated_1rm: estimated1rm,
      last_weight_kg: lastWeight,
      last_rpe: lastRpe,
      trend,
    }
  }

  if (lastRpe === 9) {
    return {
      recommended_kg: lastWeight,
      reasoning: `Hard effort (RPE ${lastRpe}) — maintain weight, focus on reps`,
      confidence: "medium",
      estimated_1rm: estimated1rm,
      last_weight_kg: lastWeight,
      last_rpe: lastRpe,
      trend,
    }
  }

  // RPE 10 — decrease
  return {
    recommended_kg: Math.max(0, lastWeight - increment),
    reasoning: `Max effort last session (RPE ${lastRpe}) — reduce by ${increment}kg`,
    confidence: "medium",
    estimated_1rm: estimated1rm,
    last_weight_kg: lastWeight,
    last_rpe: lastRpe,
    trend,
  }
}
