import type { CompressedExercise, ExerciseSlot, ProgramSkeleton, ProfileAnalysis } from "./types.js"
import { slotToText, embedText } from "./embeddings.js"
import { getSupabase } from "../lib/supabase.js"
import type { UsageRecencyMap } from "./usage-history.js"

const COACH_USAGE_PENALTY = 30
const CLIENT_USAGE_PENALTY = 50
const DIVERSITY_BOOST = 10
/** Boost applied in "preferred" pool mode to exercises in the coach-curated pool. */
const POOL_PREFERENCE_BOOST = 40
/** Soft boost for a client's favorited exercises. Between DIVERSITY_BOOST (10)
 *  and POOL_PREFERENCE_BOOST (40): meaningful but won't override hard filters
 *  (injury/equipment/difficulty run BEFORE scoring) or weekly rotation
 *  (clientUsage penalty is 50). */
const FAVORITE_BOOST = 30

/** Score offset applied per (run, exercise) so tie groups reshuffle each run. */
const JITTER_RANGE = 8

/**
 * Neutral relevance used when an exercise has no embedding similarity — e.g. a
 * preferred-pool entry injected after the semantic search missed it.
 */
const NEUTRAL_SIMILARITY = 0.5

/** Embedding similarity is 0..1; scale it into the same range as the boosts. */
const SIMILARITY_SCALE = 100

function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

function mulberry32(a: number): number {
  let t = (a += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/**
 * Deterministic per-(seed, exercise) score offset in [-range, +range].
 *
 * Large enough to reshuffle near-ties — which is most of the list once base
 * scores cluster — small enough that a genuine relevance gap still wins. With
 * no seed this returns 0, so unseeded callers keep their previous ordering.
 */
export function seededJitter(seed: string | undefined, exerciseId: string, range = JITTER_RANGE): number {
  if (!seed) return 0
  return (mulberry32(hashString(`${seed}:${exerciseId}`)) - 0.5) * 2 * range
}

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
  /** True in strict pool mode — library has already been hard-filtered to the pool. */
  poolActive?: boolean
  coachUsage?: UsageRecencyMap
  clientUsage?: UsageRecencyMap
  /** Exercise IDs to physically remove from the candidate set (hard prune). */
  excludeIds?: Set<string>
  /**
   * Exercise IDs the coach has marked as preferred (the Exercise Pool in
   * "preferred" mode). These are NOT a hard restriction — they receive a
   * scoring boost so the pool is prioritized while leaving the rest of the
   * library available as fallback.
   */
  preferredIds?: Set<string>
  /** Exercise IDs the CLIENT has favorited — a soft scoring boost (FAVORITE_BOOST). */
  favoriteIds?: Set<string>
  /** MMR balance: 1.0 = pure relevance, 0.0 = pure diversity. Default 0.7. */
  mmrLambda?: number
  /**
   * Per-run seed (the ai_generation_log row id). Drives deterministic tie-break
   * jitter so two identical requests produce different programs while any single
   * run stays reproducible from its logged id.
   */
  seed?: string
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

  // Preferred pool boost — bias toward coach-curated exercises without
  // hard-restricting the library (preferred mode).
  const preferredIds = options?.preferredIds
  if (preferredIds && preferredIds.size > 0) {
    for (const [id, score] of exerciseMaxScores) {
      if (preferredIds.has(id)) exerciseMaxScores.set(id, score + POOL_PREFERENCE_BOOST)
    }
  }

  // Favorites boost — soft bias toward client-favorited exercises.
  const favoriteIds = options?.favoriteIds
  if (favoriteIds && favoriteIds.size > 0) {
    for (const [id, score] of exerciseMaxScores) {
      if (favoriteIds.has(id)) exerciseMaxScores.set(id, score + FAVORITE_BOOST)
    }
  }

  // Hard-prune excluded IDs (used for cross-week dedup defense in depth)
  const excludeIds = options?.excludeIds
  const candidates = excludeIds && excludeIds.size > 0 ? exercises.filter((e) => !excludeIds.has(e.id)) : exercises

  const scoredAll = candidates.map((e) => ({
    exercise: e,
    score: (exerciseMaxScores.get(e.id) ?? 0) + seededJitter(options?.seed, e.id),
  }))
  scoredAll.sort((a, b) => b.score - a.score)
  const sortedAfterExclude = scoredAll.map((s) => s.exercise)

  const cutoff = Math.min(maxExercises, scoredAll.length)
  const lambda = options?.mmrLambda
  // MMR must SELECT the survivors, not reorder an already-truncated list.
  // Passing k === list length made diversifyByMMR return its input untouched,
  // so this diversification never actually ran.
  const useMMR = lambda !== undefined && lambda < 1.0 && scoredAll.length > cutoff
  let filtered = useMMR
    ? diversifyByMMR(scoredAll, cutoff, lambda)
    : scoredAll.slice(0, cutoff).map((s) => s.exercise)

  // When pool is active, never fall back to unfiltered — use whatever the pool has.
  // Fall back to the exclude-pruned set so excludeIds is always respected.
  if (!isPool && filtered.length < MIN_EXERCISES) filtered = sortedAfterExclude

  // Ensure pattern balance — pass the exclude-pruned set so balance top-ups never re-introduce excluded exercises
  filtered = ensurePatternBalance(filtered, sortedAfterExclude, skeleton, equipment, difficulty, { poolActive: isPool })

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

  // match_exercises returns (id, similarity). Keeping the similarity is what
  // gives the ranker a real relevance signal — discarding it left every
  // exercise on an identical base score, so ordering collapsed to DB order.
  const matchScores = new Map<string, number>()
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
        const similarity = typeof match.similarity === "number" ? match.similarity : 0
        const prev = matchScores.get(match.id)
        if (prev === undefined || similarity > prev) matchScores.set(match.id, similarity)
      }
    } catch (err) {
      console.warn(
        `[semanticFilter] Embedding search failed for slot ${slot.slot_id}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  console.log(
    `[semanticFilter] ${matchScores.size} unique matches from ${slotGroups.size} slot groups (${matchCountPerSlot}/slot)${isPool ? " [pool]" : ""}`,
  )

  // When pool is active, don't fall back for "too few" matches — use whatever matched
  const minRequired = isPool ? 1 : MIN_EXERCISES
  if (matchScores.size < minRequired) {
    console.log(`[semanticFilter] Only ${matchScores.size} matches — falling back to heuristic filter`)
    return scoreAndFilterExercises(exercises, skeleton, equipment, analysis, {
      poolActive: isPool,
      coachUsage: options?.coachUsage,
      clientUsage: options?.clientUsage,
      excludeIds: options?.excludeIds,
      preferredIds: options?.preferredIds,
      favoriteIds: options?.favoriteIds,
      mmrLambda: options?.mmrLambda,
      seed: options?.seed,
    })
  }

  let filtered = exercises.filter((ex) => matchScores.has(ex.id))

  if (options?.excludeIds && options.excludeIds.size > 0) {
    const before = filtered.length
    filtered = filtered.filter((e) => !options.excludeIds!.has(e.id))
    console.log(`[semanticFilter] excludeIds removed ${before - filtered.length} exercises`)
  }

  const coachUsage = options?.coachUsage ?? new Map<string, number>()
  const clientUsage = options?.clientUsage ?? new Map<string, number>()
  const preferredIds = options?.preferredIds
  const hasPreferred = !!preferredIds && preferredIds.size > 0
  const favoriteIds = options?.favoriteIds
  const hasFavorites = !!favoriteIds && favoriteIds.size > 0

  // Inject any missing preferred-pool exercises into the candidate set BEFORE
  // scoring — semantic search may have ranked them out, but in preferred mode
  // we want the AI to see them and the boost to act on them.
  if (hasPreferred) {
    const inFiltered = new Set(filtered.map((e) => e.id))
    const missingPreferred = exercises.filter((e) => preferredIds!.has(e.id) && !inFiltered.has(e.id))
    if (missingPreferred.length > 0) {
      console.log(`[semanticFilter] Injecting ${missingPreferred.length} preferred-pool exercises missed by embeddings`)
      filtered = [...missingPreferred, ...filtered]
    }
  }

  // Embedding similarity is the relevance term. A preferred-pool injection that
  // never matched has no similarity, so it falls back to the neutral midpoint.
  const scoredAll = filtered.map((e) => ({
    exercise: e,
    score:
      applyUsagePenalty(
        (matchScores.get(e.id) ?? NEUTRAL_SIMILARITY) * SIMILARITY_SCALE,
        e.id,
        coachUsage,
        clientUsage,
      ) +
      (hasPreferred && preferredIds!.has(e.id) ? POOL_PREFERENCE_BOOST : 0) +
      (hasFavorites && favoriteIds!.has(e.id) ? FAVORITE_BOOST : 0) +
      seededJitter(options?.seed, e.id),
  }))
  scoredAll.sort((a, b) => b.score - a.score)

  const cutoff = Math.min(maxExercises, scoredAll.length)
  const lambda = options?.mmrLambda
  // MMR must SELECT the survivors, not reorder an already-truncated list.
  const useMMR = lambda !== undefined && lambda < 1.0 && scoredAll.length > cutoff
  filtered = useMMR
    ? diversifyByMMR(scoredAll, cutoff, lambda)
    : scoredAll.slice(0, cutoff).map((s) => s.exercise)

  console.log(
    `[semanticFilter] Ranked ${scoredAll.length} candidates by similarity` +
      `${options?.seed ? " (seeded)" : ""}${useMMR ? ` + MMR lambda=${lambda}` : ""} -> ${filtered.length}` +
      ` (coach usage: ${coachUsage.size}, client usage: ${clientUsage.size}` +
      `${hasPreferred ? `, pool preferred: ${preferredIds!.size}` : ""}` +
      `${hasFavorites ? `, favorites: ${favoriteIds!.size}` : ""})`,
  )

  // Ensure pattern balance — when pool active, only pulls from pool exercises.
  // Build balancePool so excludeIds are never re-introduced via pattern-balance backfill.
  const balancePool =
    options?.excludeIds && options.excludeIds.size > 0
      ? exercises.filter((e) => !options.excludeIds!.has(e.id))
      : exercises
  filtered = ensurePatternBalance(filtered, balancePool, skeleton, equipment, difficulty, { poolActive: isPool })

  console.log(`[semanticFilter] Final: ${filtered.length} exercises (max: ${maxExercises})${isPool ? " [pool]" : ""}`)
  return filtered
}

// ─── MMR diversification ────────────────────────────────────────────────────

interface MMRSimVector {
  movement_pattern: string
  primary: Set<string>
  equipment: Set<string>
  intent: Set<string>
}

function vectorize(ex: CompressedExercise): MMRSimVector {
  return {
    movement_pattern: ex.movement_pattern ?? "",
    primary: new Set(ex.primary_muscles.map((m) => m.toLowerCase())),
    equipment: new Set(ex.equipment_required.map((e) => e.toLowerCase())),
    intent: new Set(ex.training_intent ?? []),
  }
}

function jaccardSet(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const v of a) if (b.has(v)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function mmrSimilarity(a: MMRSimVector, b: MMRSimVector): number {
  const patternMatch = a.movement_pattern && a.movement_pattern === b.movement_pattern ? 1 : 0
  return (
    0.4 * patternMatch +
    0.3 * jaccardSet(a.primary, b.primary) +
    0.2 * jaccardSet(a.equipment, b.equipment) +
    0.1 * jaccardSet(a.intent, b.intent)
  )
}

/**
 * Maximal Marginal Relevance: pick top-k items balancing score (relevance) and
 * diversity from already-selected items. lambda in [0,1]; 1.0 = pure score,
 * 0.0 = pure diversity. Default 0.7.
 */
export function diversifyByMMR(
  scored: Array<{ exercise: CompressedExercise; score: number }>,
  k: number,
  lambda = 0.7,
): CompressedExercise[] {
  if (scored.length <= k) return scored.map((s) => s.exercise)
  const remaining = [...scored]
  const selected: Array<{ exercise: CompressedExercise; vec: MMRSimVector }> = []
  // Normalize scores to [0,1] for fair combination with similarity.
  const maxScore = Math.max(...remaining.map((s) => s.score), 1)
  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0
    let bestVal = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]
      const candVec = vectorize(cand.exercise)
      const rel = cand.score / maxScore
      let maxSim = 0
      for (const sel of selected) {
        const sim = mmrSimilarity(candVec, sel.vec)
        if (sim > maxSim) maxSim = sim
      }
      const mmr = lambda * rel - (1 - lambda) * maxSim
      if (mmr > bestVal) {
        bestVal = mmr
        bestIdx = i
      }
    }
    const pick = remaining.splice(bestIdx, 1)[0]
    selected.push({ exercise: pick.exercise, vec: vectorize(pick.exercise) })
  }
  return selected.map((s) => s.exercise)
}
