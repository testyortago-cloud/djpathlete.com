import { createServiceRoleClient } from "@/lib/supabase"
import { estimate1RM } from "@/lib/weight-recommendation"
import type { ExerciseProgress, PrType } from "@/types/database"

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PrCheckResult {
  isPr: boolean
  prType: PrType | null
  title: string
  description: string
  metricValue: number | null
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getClient() {
  return createServiceRoleClient()
}

/** Parse reps string like "8" or "8-12" into a single number (uses the lower end) */
function parseReps(reps: string | null): number | null {
  if (!reps) return null
  const match = reps.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Fetch all previous progress entries for a user + exercise combo.
 * Single query — all PR comparison logic runs in JS.
 */
async function fetchExerciseHistory(
  userId: string,
  exerciseId: string
): Promise<ExerciseProgress[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId)
    .order("completed_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as ExerciseProgress[]
}

// ─── Individual PR Checks ───────────────────────────────────────────────────

export async function checkWeightPR(
  userId: string,
  exerciseId: string,
  newWeightKg: number
): Promise<PrCheckResult> {
  const history = await fetchExerciseHistory(userId, exerciseId)
  return checkWeightPRFromHistory(history, newWeightKg)
}

export async function checkRepPR(
  userId: string,
  exerciseId: string,
  newWeightKg: number,
  newReps: number
): Promise<PrCheckResult> {
  const history = await fetchExerciseHistory(userId, exerciseId)
  return checkRepPRFromHistory(history, newWeightKg, newReps)
}

export async function checkVolumePR(
  userId: string,
  exerciseId: string,
  sets: number,
  reps: number,
  weightKg: number
): Promise<PrCheckResult> {
  const history = await fetchExerciseHistory(userId, exerciseId)
  return checkVolumePRFromHistory(history, sets, reps, weightKg)
}

export async function checkEstimated1RMPR(
  userId: string,
  exerciseId: string,
  weightKg: number,
  reps: number
): Promise<PrCheckResult> {
  const history = await fetchExerciseHistory(userId, exerciseId)
  return checkEstimated1RMPRFromHistory(history, weightKg, reps)
}

// ─── In-Memory PR Logic (operates on pre-fetched history) ──────────────────

function checkWeightPRFromHistory(
  history: ExerciseProgress[],
  newWeightKg: number
): PrCheckResult {
  if (history.length === 0) {
    return { isPr: false, prType: null, title: "", description: "", metricValue: null }
  }

  const previousMaxWeight = Math.max(
    ...history.map((h) => h.weight_kg ?? 0)
  )

  if (newWeightKg > previousMaxWeight) {
    return {
      isPr: true,
      prType: "weight",
      title: "Weight PR!",
      description: `New heaviest weight: ${newWeightKg}kg (previous: ${previousMaxWeight}kg)`,
      metricValue: newWeightKg,
    }
  }

  return { isPr: false, prType: null, title: "", description: "", metricValue: null }
}

function checkRepPRFromHistory(
  history: ExerciseProgress[],
  newWeightKg: number,
  newReps: number
): PrCheckResult {
  if (history.length === 0) {
    return { isPr: false, prType: null, title: "", description: "", metricValue: null }
  }

  // Find previous entries at the same or higher weight
  const relevantEntries = history.filter(
    (h) => h.weight_kg != null && h.weight_kg >= newWeightKg
  )

  if (relevantEntries.length === 0) {
    // No previous entries at this weight or higher — not a rep PR
    // (could be a weight PR instead, which is checked separately)
    return { isPr: false, prType: null, title: "", description: "", metricValue: null }
  }

  const previousMaxReps = Math.max(
    ...relevantEntries.map((h) => parseReps(h.reps_completed) ?? 0)
  )

  if (newReps > previousMaxReps) {
    return {
      isPr: true,
      prType: "reps",
      title: "Rep PR!",
      description: `New most reps at ${newWeightKg}kg+: ${newReps} reps (previous: ${previousMaxReps})`,
      metricValue: newReps,
    }
  }

  return { isPr: false, prType: null, title: "", description: "", metricValue: null }
}

function checkVolumePRFromHistory(
  history: ExerciseProgress[],
  sets: number,
  reps: number,
  weightKg: number
): PrCheckResult {
  if (history.length === 0) {
    return { isPr: false, prType: null, title: "", description: "", metricValue: null }
  }

  const newVolume = sets * reps * weightKg

  const previousMaxVolume = Math.max(
    ...history.map((h) => {
      const hReps = parseReps(h.reps_completed) ?? 0
      const hSets = h.sets_completed ?? 0
      const hWeight = h.weight_kg ?? 0
      return hSets * hReps * hWeight
    })
  )

  if (newVolume > previousMaxVolume) {
    return {
      isPr: true,
      prType: "volume",
      title: "Volume PR!",
      description: `New session volume record: ${newVolume.toLocaleString()}kg (previous: ${previousMaxVolume.toLocaleString()}kg)`,
      metricValue: newVolume,
    }
  }

  return { isPr: false, prType: null, title: "", description: "", metricValue: null }
}

function checkEstimated1RMPRFromHistory(
  history: ExerciseProgress[],
  weightKg: number,
  reps: number
): PrCheckResult {
  if (history.length === 0) {
    return { isPr: false, prType: null, title: "", description: "", metricValue: null }
  }

  const new1RM = Math.round(estimate1RM(weightKg, reps))

  const previous1RMs = history
    .filter((h) => h.weight_kg != null && h.weight_kg > 0 && h.reps_completed != null)
    .map((h) => {
      const hReps = parseReps(h.reps_completed) ?? 0
      return estimate1RM(h.weight_kg!, hReps)
    })

  if (previous1RMs.length === 0) {
    return { isPr: false, prType: null, title: "", description: "", metricValue: null }
  }

  const previousMax1RM = Math.round(Math.max(...previous1RMs))

  if (new1RM > previousMax1RM) {
    return {
      isPr: true,
      prType: "estimated_1rm",
      title: "Estimated 1RM PR!",
      description: `New estimated 1RM: ${new1RM}kg (previous: ${previousMax1RM}kg)`,
      metricValue: new1RM,
    }
  }

  return { isPr: false, prType: null, title: "", description: "", metricValue: null }
}

// ─── Main Detection ─────────────────────────────────────────────────────────

/**
 * Check ALL PR types for a given workout log entry.
 * Fetches history once and runs all checks in memory.
 * Returns an array of PRs found (may be empty).
 */
export async function detectPRs(
  userId: string,
  exerciseId: string,
  exerciseName: string,
  data: {
    weight_kg: number | null
    reps_completed: string | null
    sets_completed: number | null
  }
): Promise<PrCheckResult[]> {
  const history = await fetchExerciseHistory(userId, exerciseId)

  // Need at least 1 previous entry for anything to count as a PR
  if (history.length === 0) return []

  const weightKg = data.weight_kg
  const reps = parseReps(data.reps_completed)
  const sets = data.sets_completed

  // If no weight data, can't check weight-based PRs
  if (weightKg == null || weightKg <= 0) return []

  const prs: PrCheckResult[] = []

  // Check weight PR
  const weightResult = checkWeightPRFromHistory(history, weightKg)
  if (weightResult.isPr) {
    weightResult.title = `${exerciseName} — Weight PR!`
    prs.push(weightResult)
  }

  // Check rep PR (need reps)
  if (reps != null && reps > 0) {
    const repResult = checkRepPRFromHistory(history, weightKg, reps)
    if (repResult.isPr) {
      repResult.title = `${exerciseName} — Rep PR!`
      prs.push(repResult)
    }
  }

  // Check volume PR (need sets and reps)
  if (sets != null && sets > 0 && reps != null && reps > 0) {
    const volumeResult = checkVolumePRFromHistory(history, sets, reps, weightKg)
    if (volumeResult.isPr) {
      volumeResult.title = `${exerciseName} — Volume PR!`
      prs.push(volumeResult)
    }
  }

  // Check estimated 1RM PR (need reps)
  if (reps != null && reps > 0) {
    const e1rmResult = checkEstimated1RMPRFromHistory(history, weightKg, reps)
    if (e1rmResult.isPr) {
      e1rmResult.title = `${exerciseName} — Estimated 1RM PR!`
      prs.push(e1rmResult)
    }
  }

  return prs
}

// ─── Milestone Checks ───────────────────────────────────────────────────────

const STREAK_MILESTONES = [7, 14, 30, 60, 90, 180, 365] as const
const WORKOUT_MILESTONES = [10, 25, 50, 100, 250, 500, 1000] as const

/**
 * Check if the current streak matches a milestone AND the user hasn't
 * already earned an achievement for that streak length.
 */
export async function checkStreakMilestones(
  userId: string,
  currentStreak: number
): Promise<PrCheckResult | null> {
  const milestone = STREAK_MILESTONES.find((m) => m === currentStreak)
  if (!milestone) return null

  // Check if achievement already exists
  const supabase = getClient()
  const { count, error } = await supabase
    .from("achievements")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("achievement_type", "streak")
    .eq("metric_value", milestone)
  if (error) throw error

  if ((count ?? 0) > 0) return null

  return {
    isPr: true,
    prType: null,
    title: `${milestone}-Day Streak!`,
    description: `You've worked out ${milestone} days in a row. Incredible consistency!`,
    metricValue: milestone,
  }
}

/**
 * Check if the total workout count matches a milestone AND the user hasn't
 * already earned an achievement for that count.
 */
export async function checkWorkoutMilestones(
  userId: string,
  totalWorkouts: number
): Promise<PrCheckResult | null> {
  const milestone = WORKOUT_MILESTONES.find((m) => m === totalWorkouts)
  if (!milestone) return null

  // Check if achievement already exists
  const supabase = getClient()
  const { count, error } = await supabase
    .from("achievements")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("achievement_type", "milestone")
    .eq("metric_value", milestone)
  if (error) throw error

  if ((count ?? 0) > 0) return null

  return {
    isPr: true,
    prType: null,
    title: `${milestone} Workouts!`,
    description: `You've completed ${milestone} total workouts. Keep pushing!`,
    metricValue: milestone,
  }
}
