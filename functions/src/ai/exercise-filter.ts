import type { CompressedExercise, ExerciseSlot, ProgramSkeleton, ProfileAnalysis } from "./types.js"
import { slotToText, embedText } from "./embeddings.js"
import { getSupabase } from "../lib/supabase.js"
import type { UsageRecencyMap } from "./usage-history.js"

const COACH_USAGE_PENALTY = 30
const CLIENT_USAGE_PENALTY = 50
const DIVERSITY_BOOST = 10

/**
 * Apply usage-history penalties and a diversity boost to a base score.
 * - Used by this coach in last 60 days → -30
 * - Used by this client in last 90 days → -50
 * - Used by neither → +10 (diversity boost)
 */
export function applyUsagePenalty(
  baseScore: number,
  exerciseId: string,
  coachUsage: UsageRecencyMap,
  clientUsage: UsageRecencyMap,
): number {
  let score = baseScore
  const hasUsageData = coachUsage.size > 0 || clientUsage.size > 0
  if (!hasUsageData) return score
  const inCoach = coachUsage.has(exerciseId)
  const inClient = clientUsage.has(exerciseId)
  if (inCoach) score -= COACH_USAGE_PENALTY
  if (inClient) score -= CLIENT_USAGE_PENALTY
  if (!inCoach && !inClient) score += DIVERSITY_BOOST
  return score
}

export interface FilterOptions {
  poolActive?: boolean
  coachUsage?: UsageRecencyMap
  clientUsage?: UsageRecencyMap
}

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

// ─── Core movement patterns that MUST be represented in the filtered set ────

const CORE_PATTERNS = ["push", "pull", "squat", "hinge", "lunge"] as const

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

const DIFFICULTY_ORDER = ["beginner", "intermediate", "advanced"] as const

function difficultyDistance(a: string, b: string): number {
  const idxA = DIFFICULTY_ORDER.indexOf(a as (typeof DIFFICULTY_ORDER)[number])
  const idxB = DIFFICULTY_ORDER.indexOf(b as (typeof DIFFICULTY_ORDER)[number])
  if (idxA === -1 || idxB === -1) return 2
  return Math.abs(idxA - idxB)
}

export interface ClientContext {
  sport?: string | null
  injuredJoints?: string[]
}

export function scoreExerciseForSlot(
  exercise: CompressedExercise,
  slot: ExerciseSlot,
  equipment: string[],
  difficulty: string,
  clientContext?: ClientContext,
): number {
  let score = 0
  if (exercise.movement_pattern === slot.movement_pattern) score += 35
  else if (exercise.movement_pattern && RELATED_PATTERNS[slot.movement_pattern]?.includes(exercise.movement_pattern))
    score += 15

  const allExerciseMuscles = [...exercise.primary_muscles, ...exercise.secondary_muscles]
  score += Math.round(jaccard(allExerciseMuscles, slot.target_muscles) * 25)

  const equipmentSet = new Set(equipment.map((e) => e.toLowerCase()))
  if (exercise.is_bodyweight) score += 15
  else if (
    exercise.equipment_required.length === 0 ||
    exercise.equipment_required.every((eq) => equipmentSet.has(eq.toLowerCase()))
  )
    score += 15

  // Difficulty matching — heavily weighted to prevent advanced exercises for beginners
  const dist = difficultyDistance(exercise.difficulty, difficulty)
  if (dist === 0)
    score += 20 // exact match
  else if (dist === 1) {
    // One level off: penalize exercises ABOVE client level more than below
    const exerciseDiffIdx = DIFFICULTY_ORDER.indexOf(exercise.difficulty as (typeof DIFFICULTY_ORDER)[number])
    const clientDiffIdx = DIFFICULTY_ORDER.indexOf(difficulty as (typeof DIFFICULTY_ORDER)[number])
    if (exerciseDiffIdx > clientDiffIdx)
      score += 2 // exercise is harder than client — near-zero score
    else score += 10 // exercise is easier than client — acceptable
  }
  // dist >= 2: 0 points (e.g., advanced exercise for beginner)

  // Role bonus (5pts) — training_intent matching slot role
  const isCompoundSlot = slot.role === "primary_compound" || slot.role === "secondary_compound"
  const isIsolationSlot = slot.role === "isolation" || slot.role === "accessory"
  const intent = exercise.training_intent ?? ["build"]
  if (isCompoundSlot && (intent.includes("shape") || intent.includes("express"))) score += 5
  if (isIsolationSlot && intent.includes("build")) score += 5

  // Sport transfer bonus (+10) — exercise tagged for client's sport
  if (clientContext?.sport && exercise.sport_tags?.length > 0) {
    const sportNorm = clientContext.sport.toLowerCase().replace(/\s+/g, "_")
    if (exercise.sport_tags.some((t) => t.toLowerCase() === sportNorm)) score += 10
  }

  // Joint injury penalty — deprioritize exercises that load injured joints
  if (clientContext?.injuredJoints?.length && exercise.joints_loaded?.length > 0) {
    for (const jl of exercise.joints_loaded) {
      if (clientContext.injuredJoints.includes(jl.joint)) {
        if (jl.load === "high") score -= 20
        else if (jl.load === "moderate") score -= 10
        else score -= 3
      }
    }
  }

  return score
}

// ─── Injury-aware joint filter ────────────────────────────────────────────

export function filterByInjuredJoints(exercises: CompressedExercise[], injuredJoints: string[]): CompressedExercise[] {
  if (injuredJoints.length === 0) return exercises
  return exercises.filter((ex) => {
    if (!ex.joints_loaded || ex.joints_loaded.length === 0) return true
    // Exclude exercises with HIGH load on any injured joint
    return !ex.joints_loaded.some((jl) => injuredJoints.includes(jl.joint) && jl.load === "high")
  })
}

// ─── Plane-of-motion balance analysis ─────────────────────────────────────

export function analyzePlaneBalance(exercises: CompressedExercise[]): {
  sagittal: number
  frontal: number
  transverse: number
} {
  const counts = { sagittal: 0, frontal: 0, transverse: 0 }
  for (const ex of exercises) {
    for (const plane of ex.plane_of_motion ?? []) {
      if (plane in counts) counts[plane as keyof typeof counts]++
    }
  }
  return counts
}

function slotGroupKey(slot: ExerciseSlot): string {
  const muscles = [...slot.target_muscles].sort().join(",")
  return `${slot.movement_pattern}|${muscles}`
}

// ─── Dynamic caps based on library size ─────────────────────────────────────

const MIN_EXERCISES = 30
const MIN_PER_PATTERN = 8 // Guarantee at least 8 exercises per core movement pattern

function getMaxExercises(librarySize: number): number {
  // Scale: 15% of library, clamped between 80 and 200
  return Math.max(80, Math.min(200, Math.round(librarySize * 0.15)))
}

// ─── Pattern-balanced guarantee ─────────────────────────────────────────────
// After initial filtering, check that every movement pattern required by the
// skeleton has at least MIN_PER_PATTERN exercises. If not, pull in the best
// candidates from the full library for the underrepresented patterns.

interface PatternBalanceOptions {
  /** When true, only pull from allExercises (already pool-filtered) — never inject outside pool */
  poolActive?: boolean
}

function ensurePatternBalance(
  filtered: CompressedExercise[],
  allExercises: CompressedExercise[],
  skeleton: ProgramSkeleton,
  equipment: string[],
  difficulty: string,
  options?: PatternBalanceOptions,
): CompressedExercise[] {
  const isPool = options?.poolActive ?? false
  // When a pool is active, use a softer minimum — the coach curated this set intentionally.
  // Require at least 2 per pattern (enough for variety) instead of the normal 8.
  const minPerPattern = isPool ? Math.min(2, Math.ceil(allExercises.length / 10)) : MIN_PER_PATTERN

  // Determine which patterns the skeleton actually needs
  const requiredPatterns = new Set<string>()
  for (const week of skeleton.weeks) {
    for (const day of week.days) {
      for (const slot of day.slots) {
        requiredPatterns.add(slot.movement_pattern)
      }
    }
  }

  // When pool is active, only require patterns the skeleton needs — don't force all CORE_PATTERNS
  // since the coach may have intentionally excluded certain movement types
  if (!isPool) {
    for (const pattern of CORE_PATTERNS) {
      requiredPatterns.add(pattern)
    }
  }

  // Count exercises per pattern in filtered set
  const patternCounts = new Map<string, number>()
  const filteredIds = new Set(filtered.map((e) => e.id))
  for (const ex of filtered) {
    if (ex.movement_pattern) {
      patternCounts.set(ex.movement_pattern, (patternCounts.get(ex.movement_pattern) ?? 0) + 1)
    }
  }

  // Find underrepresented patterns
  const additions: CompressedExercise[] = []
  for (const pattern of requiredPatterns) {
    const count = patternCounts.get(pattern) ?? 0
    if (count >= minPerPattern) continue

    const needed = minPerPattern - count
    // Find best candidates from allExercises (already pool-scoped when pool is active)
    const candidates = allExercises.filter((ex) => ex.movement_pattern === pattern && !filteredIds.has(ex.id))

    // Score candidates against a synthetic slot for this pattern
    const equipmentSet = new Set(equipment.map((e) => e.toLowerCase()))
    const scored = candidates
      .map((ex) => {
        let score = 0
        // Equipment match
        if (ex.is_bodyweight) score += 20
        else if (
          ex.equipment_required.length === 0 ||
          ex.equipment_required.every((eq) => equipmentSet.has(eq.toLowerCase()))
        )
          score += 20
        // Difficulty match
        const dist = difficultyDistance(ex.difficulty, difficulty)
        if (dist === 0) score += 10
        else if (dist === 1) score += 5
        return { exercise: ex, score }
      })
      .sort((a, b) => b.score - a.score)

    const toAdd = scored.slice(0, needed).map((s) => s.exercise)
    for (const ex of toAdd) {
      additions.push(ex)
      filteredIds.add(ex.id)
    }

    if (toAdd.length > 0) {
      console.log(
        `[patternBalance] Added ${toAdd.length} ${pattern} exercises (had ${count}, now ${count + toAdd.length})${isPool ? " [pool-scoped]" : ""}`,
      )
    }
  }

  if (additions.length > 0) {
    return [...filtered, ...additions]
  }
  return filtered
}

// ─── Heuristic filter (fallback) ────────────────────────────────────────────

export function scoreAndFilterExercises(
  exercises: CompressedExercise[],
  skeleton: ProgramSkeleton,
  equipment: string[],
  analysis: ProfileAnalysis,
  options?: FilterOptions,
): CompressedExercise[] {
  const difficulty =
    analysis.training_age_category === "novice"
      ? "beginner"
      : analysis.training_age_category === "elite"
        ? "advanced"
        : analysis.training_age_category

  const isPool = options?.poolActive ?? false
  // When pool is active, keep ALL pool exercises — don't cap. The coach selected them.
  const maxExercises = isPool ? exercises.length : getMaxExercises(exercises.length)

  const slotGroups = new Map<string, ExerciseSlot>()
  for (const week of skeleton.weeks) {
    for (const day of week.days) {
      for (const slot of day.slots) {
        const key = slotGroupKey(slot)
        if (!slotGroups.has(key)) slotGroups.set(key, slot)
      }
    }
  }

  const exerciseMaxScores = new Map<string, number>()
  for (const exercise of exercises) {
    let maxScore = 0
    for (const slot of slotGroups.values()) {
      const score = scoreExerciseForSlot(exercise, slot, equipment, difficulty)
      if (score > maxScore) maxScore = score
    }
    exerciseMaxScores.set(exercise.id, maxScore)
  }

  const coachUsage = options?.coachUsage ?? new Map<string, number>()
  const clientUsage = options?.clientUsage ?? new Map<string, number>()
  if (coachUsage.size > 0 || clientUsage.size > 0) {
    for (const [id, score] of exerciseMaxScores) {
      exerciseMaxScores.set(id, applyUsagePenalty(score, id, coachUsage, clientUsage))
    }
  }

  const sorted = [...exercises].sort((a, b) => {
    return (exerciseMaxScores.get(b.id) ?? 0) - (exerciseMaxScores.get(a.id) ?? 0)
  })

  const cutoff = Math.min(maxExercises, sorted.length)
  let filtered = sorted.slice(0, cutoff)
  // When pool is active, never fall back to unfiltered — use whatever the pool has
  if (!isPool && filtered.length < MIN_EXERCISES) filtered = exercises

  // Ensure pattern balance
  filtered = ensurePatternBalance(filtered, exercises, skeleton, equipment, difficulty, { poolActive: isPool })

  console.log(
    `[scoreAndFilter] ${exercises.length} → ${filtered.length} exercises (max: ${maxExercises})${isPool ? " [pool]" : ""}`,
  )
  return filtered
}

// ─── Semantic filter (primary) ──────────────────────────────────────────────

export async function semanticFilterExercises(
  exercises: CompressedExercise[],
  skeleton: ProgramSkeleton,
  equipment: string[],
  analysis: ProfileAnalysis,
  options?: FilterOptions,
): Promise<CompressedExercise[]> {
  const supabase = getSupabase()
  const isPool = options?.poolActive ?? false
  const maxExercises = isPool ? exercises.length : getMaxExercises(exercises.length)

  const difficulty =
    analysis.training_age_category === "novice"
      ? "beginner"
      : analysis.training_age_category === "elite"
        ? "advanced"
        : analysis.training_age_category

  const slotGroups = new Map<string, ExerciseSlot>()
  for (const week of skeleton.weeks) {
    for (const day of week.days) {
      for (const slot of day.slots) {
        const key = slotGroupKey(slot)
        if (!slotGroups.has(key)) slotGroups.set(key, slot)
      }
    }
  }

  // When pool is active, use the pool exercise IDs to scope the semantic search
  const poolIdSet = isPool ? new Set(exercises.map((e) => e.id)) : null

  // Scale match_count per slot based on library size — more exercises = wider net
  const matchCountPerSlot = Math.max(30, Math.min(60, Math.round(exercises.length * 0.05)))

  const matchedIds = new Set<string>()
  for (const slot of slotGroups.values()) {
    try {
      const queryText = slotToText(slot)
      const queryEmbedding = await embedText(queryText)
      const { data } = await supabase.rpc("match_exercises", {
        query_embedding: JSON.stringify(queryEmbedding),
        match_threshold: 0.15,
        match_count: isPool ? Math.max(matchCountPerSlot, exercises.length) : matchCountPerSlot,
      })
      for (const match of data ?? []) {
        // When pool is active, only accept matches that are in the pool
        if (poolIdSet && !poolIdSet.has(match.id)) continue
        matchedIds.add(match.id)
      }
    } catch (err) {
      console.warn(
        `[semanticFilter] Embedding search failed for slot ${slot.slot_id}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  console.log(
    `[semanticFilter] ${matchedIds.size} unique matches from ${slotGroups.size} slot groups (${matchCountPerSlot}/slot)${isPool ? " [pool]" : ""}`,
  )

  // When pool is active, don't fall back for "too few" matches — use whatever matched
  const minRequired = isPool ? 1 : MIN_EXERCISES
  if (matchedIds.size < minRequired) {
    console.log(`[semanticFilter] Only ${matchedIds.size} matches — falling back to heuristic filter`)
    return scoreAndFilterExercises(exercises, skeleton, equipment, analysis, {
      poolActive: isPool,
      coachUsage: options?.coachUsage,
      clientUsage: options?.clientUsage,
    })
  }

  let filtered = exercises.filter((ex) => matchedIds.has(ex.id))

  const coachUsage = options?.coachUsage ?? new Map<string, number>()
  const clientUsage = options?.clientUsage ?? new Map<string, number>()
  if (coachUsage.size > 0 || clientUsage.size > 0) {
    const scored = filtered.map((ex) => ({
      ex,
      score: applyUsagePenalty(50, ex.id, coachUsage, clientUsage),
    }))
    scored.sort((a, b) => b.score - a.score)
    filtered = scored.map((s) => s.ex)
    console.log(
      `[semanticFilter] Applied usage-aware re-ranking (coach: ${coachUsage.size}, client: ${clientUsage.size})`,
    )
  }

  if (filtered.length > maxExercises) filtered = filtered.slice(0, maxExercises)

  // Ensure pattern balance — when pool active, only pulls from pool exercises
  filtered = ensurePatternBalance(filtered, exercises, skeleton, equipment, difficulty, { poolActive: isPool })

  console.log(`[semanticFilter] Final: ${filtered.length} exercises (max: ${maxExercises})${isPool ? " [pool]" : ""}`)
  return filtered
}
