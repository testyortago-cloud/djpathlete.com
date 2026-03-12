import type { CompressedExercise } from "@/lib/ai/exercise-context"

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ExerciseRelationship {
  exerciseId: string
  relatedId: string
  type: "progression" | "regression" | "alternative" | "antagonist" | "variation"
  similarity: number // 0-1
}

export interface ProgressionChain {
  pattern: string
  muscles: string[]
  exercises: {
    id: string
    name: string
    difficulty: string
    difficulty_score: number | null
    order: number
  }[]
}

export interface ExerciseGraph {
  relationships: ExerciseRelationship[]
  progressionChains: ProgressionChain[]
  antagonistPairs: Map<string, string[]>
  alternativeGroups: Map<string, string[]>
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const ANTAGONIST_MUSCLES: Record<string, string[]> = {
  chest: ["upper_back", "lats", "rear_delts"],
  upper_back: ["chest", "front_delts"],
  lats: ["chest", "shoulders"],
  shoulders: ["upper_back", "rear_delts"],
  front_delts: ["rear_delts", "upper_back"],
  rear_delts: ["front_delts", "chest"],
  biceps: ["triceps"],
  triceps: ["biceps"],
  quadriceps: ["hamstrings"],
  hamstrings: ["quadriceps"],
  hip_flexors: ["glutes"],
  glutes: ["hip_flexors"],
  core: ["lower_back"],
  lower_back: ["core"],
  obliques: ["core"],
}

const DIFFICULTY_ORDER = ["beginner", "intermediate", "advanced"] as const

const MAX_RELATIONSHIPS_PER_TYPE = 10

// ─── Helpers ────────────────────────────────────────────────────────────────────

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

function difficultyIndex(d: string): number {
  const idx = DIFFICULTY_ORDER.indexOf(d as (typeof DIFFICULTY_ORDER)[number])
  return idx === -1 ? 1 : idx
}

function effectiveDifficultyScore(ex: CompressedExercise): number {
  if (ex.difficulty_score != null) return ex.difficulty_score
  // Approximate from difficulty label: beginner=3, intermediate=5, advanced=8
  return [3, 5, 8][difficultyIndex(ex.difficulty)] ?? 5
}

function equipmentKey(ex: CompressedExercise): string {
  if (ex.is_bodyweight) return "bodyweight"
  return [...ex.equipment_required].sort().join("+") || "none"
}

// ─── Graph Building ─────────────────────────────────────────────────────────────

/**
 * Build an exercise relationship graph from the exercise library.
 * Identifies progressions, alternatives, antagonists, and variations.
 */
export function buildExerciseGraph(exercises: CompressedExercise[]): ExerciseGraph {
  const relationships: ExerciseRelationship[] = []
  const antagonistPairs = new Map<string, string[]>()
  const alternativeGroups = new Map<string, string[]>()

  // Track relationship counts per exercise per type
  const relCounts = new Map<string, Map<string, number>>()
  const addRelCount = (id: string, type: string) => {
    if (!relCounts.has(id)) relCounts.set(id, new Map())
    const counts = relCounts.get(id)!
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  const canAddRel = (id: string, type: string) => {
    const counts = relCounts.get(id)?.get(type) ?? 0
    return counts < MAX_RELATIONSHIPS_PER_TYPE
  }

  // Group exercises by movement_pattern for efficient comparisons
  const byPattern = new Map<string, CompressedExercise[]>()
  for (const ex of exercises) {
    if (!ex.movement_pattern) continue
    const existing = byPattern.get(ex.movement_pattern) ?? []
    existing.push(ex)
    byPattern.set(ex.movement_pattern, existing)
  }

  // ── Progressions, Alternatives, and Variations ──
  for (const [pattern, group] of byPattern) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]

        const primaryOverlap = jaccard(a.primary_muscles, b.primary_muscles)
        const allMusclesA = [...a.primary_muscles, ...a.secondary_muscles]
        const allMusclesB = [...b.primary_muscles, ...b.secondary_muscles]
        const totalOverlap = jaccard(allMusclesA, allMusclesB)

        if (primaryOverlap < 0.5) continue // Not related enough

        const diffA = effectiveDifficultyScore(a)
        const diffB = effectiveDifficultyScore(b)
        const diffDelta = Math.abs(diffA - diffB)
        const sameEquipment = equipmentKey(a) === equipmentKey(b)
        const sameDifficulty = a.difficulty === b.difficulty
        const sameLaterality = a.laterality === b.laterality

        // Progression/Regression: same pattern, similar muscles, different difficulty
        if (primaryOverlap > 0.5 && diffDelta >= 1.5) {
          const [easier, harder] = diffA < diffB ? [a, b] : [b, a]
          const similarity = 1 - Math.min(diffDelta / 10, 0.8)

          if (canAddRel(easier.id, "progression") && canAddRel(harder.id, "regression")) {
            relationships.push({
              exerciseId: easier.id,
              relatedId: harder.id,
              type: "progression",
              similarity,
            })
            relationships.push({
              exerciseId: harder.id,
              relatedId: easier.id,
              type: "regression",
              similarity,
            })
            addRelCount(easier.id, "progression")
            addRelCount(harder.id, "regression")
          }
        }

        // Variation: same pattern, similar muscles, same difficulty, different equipment/laterality
        if (primaryOverlap > 0.6 && sameDifficulty && (!sameEquipment || !sameLaterality)) {
          if (canAddRel(a.id, "variation") && canAddRel(b.id, "variation")) {
            relationships.push({
              exerciseId: a.id,
              relatedId: b.id,
              type: "variation",
              similarity: totalOverlap,
            })
            relationships.push({
              exerciseId: b.id,
              relatedId: a.id,
              type: "variation",
              similarity: totalOverlap,
            })
            addRelCount(a.id, "variation")
            addRelCount(b.id, "variation")
          }
        }

        // Alternative: same pattern, high primary muscle overlap, different equipment
        if (primaryOverlap > 0.7 && !sameEquipment) {
          if (canAddRel(a.id, "alternative") && canAddRel(b.id, "alternative")) {
            relationships.push({
              exerciseId: a.id,
              relatedId: b.id,
              type: "alternative",
              similarity: totalOverlap,
            })
            relationships.push({
              exerciseId: b.id,
              relatedId: a.id,
              type: "alternative",
              similarity: totalOverlap,
            })
            addRelCount(a.id, "alternative")
            addRelCount(b.id, "alternative")

            // Build alternative groups
            const groupKey = `${pattern}|${[...a.primary_muscles].sort().join(",")}`
            const existing = alternativeGroups.get(groupKey) ?? []
            if (!existing.includes(a.id)) existing.push(a.id)
            if (!existing.includes(b.id)) existing.push(b.id)
            alternativeGroups.set(groupKey, existing)
          }
        }
      }
    }
  }

  // ── Antagonist Detection ──
  for (let i = 0; i < exercises.length; i++) {
    for (let j = i + 1; j < exercises.length; j++) {
      const a = exercises[i]
      const b = exercises[j]

      // Check if primary muscles are antagonists
      let isAntagonist = false
      for (const muscleA of a.primary_muscles) {
        const antagonists = ANTAGONIST_MUSCLES[muscleA.toLowerCase()]
        if (!antagonists) continue
        for (const muscleB of b.primary_muscles) {
          if (antagonists.includes(muscleB.toLowerCase())) {
            isAntagonist = true
            break
          }
        }
        if (isAntagonist) break
      }

      if (isAntagonist && canAddRel(a.id, "antagonist") && canAddRel(b.id, "antagonist")) {
        relationships.push({
          exerciseId: a.id,
          relatedId: b.id,
          type: "antagonist",
          similarity: 0.5,
        })
        relationships.push({
          exerciseId: b.id,
          relatedId: a.id,
          type: "antagonist",
          similarity: 0.5,
        })
        addRelCount(a.id, "antagonist")
        addRelCount(b.id, "antagonist")

        // Build antagonist pair map
        const existingA = antagonistPairs.get(a.id) ?? []
        if (!existingA.includes(b.id)) existingA.push(b.id)
        antagonistPairs.set(a.id, existingA)

        const existingB = antagonistPairs.get(b.id) ?? []
        if (!existingB.includes(a.id)) existingB.push(a.id)
        antagonistPairs.set(b.id, existingB)
      }
    }
  }

  // ── Build Progression Chains ──
  const progressionChains = buildProgressionChains(exercises, relationships)

  return { relationships, progressionChains, antagonistPairs, alternativeGroups }
}

// ─── Progression Chains ─────────────────────────────────────────────────────────

function buildProgressionChains(
  exercises: CompressedExercise[],
  relationships: ExerciseRelationship[]
): ProgressionChain[] {
  const exerciseMap = new Map(exercises.map((e) => [e.id, e]))

  // Build adjacency list for progression relationships
  const progressionEdges = new Map<string, Set<string>>()
  for (const rel of relationships) {
    if (rel.type !== "progression") continue
    const edges = progressionEdges.get(rel.exerciseId) ?? new Set()
    edges.add(rel.relatedId)
    progressionEdges.set(rel.exerciseId, edges)
  }

  // Find chain starts (exercises that have progressions but no regressions)
  const hasRegression = new Set<string>()
  for (const rel of relationships) {
    if (rel.type === "regression") {
      // This exercise has a regression, meaning something is easier
      // The related exercise is easier, so the current one is NOT a start
    }
    if (rel.type === "progression") {
      // The related exercise is harder, so it has a regression from this exercise
      hasRegression.add(rel.relatedId)
    }
  }

  const chainStarts = new Set<string>()
  for (const id of progressionEdges.keys()) {
    if (!hasRegression.has(id)) {
      chainStarts.add(id)
    }
  }

  // Walk chains from each start
  const visited = new Set<string>()
  const chains: ProgressionChain[] = []

  for (const startId of chainStarts) {
    if (visited.has(startId)) continue

    const chain: string[] = []
    let current = startId

    while (current && !visited.has(current)) {
      visited.add(current)
      chain.push(current)

      // Find the next exercise in the progression
      const nextSet = progressionEdges.get(current)
      if (!nextSet || nextSet.size === 0) break

      // Pick the one with the closest difficulty (smallest step up)
      const currentEx = exerciseMap.get(current)
      if (!currentEx) break

      const currentDiff = effectiveDifficultyScore(currentEx)
      let bestNext: string | null = null
      let bestDelta = Infinity

      for (const nextId of nextSet) {
        if (visited.has(nextId)) continue
        const nextEx = exerciseMap.get(nextId)
        if (!nextEx) continue
        const delta = effectiveDifficultyScore(nextEx) - currentDiff
        if (delta > 0 && delta < bestDelta) {
          bestDelta = delta
          bestNext = nextId
        }
      }

      current = bestNext ?? ""
    }

    if (chain.length >= 2) {
      const firstEx = exerciseMap.get(chain[0])
      if (!firstEx) continue

      chains.push({
        pattern: firstEx.movement_pattern ?? "unknown",
        muscles: [...firstEx.primary_muscles],
        exercises: chain.map((id, idx) => {
          const ex = exerciseMap.get(id)!
          return {
            id: ex.id,
            name: ex.name,
            difficulty: ex.difficulty,
            difficulty_score: ex.difficulty_score,
            order: idx + 1,
          }
        }),
      })
    }
  }

  return chains
}

// ─── Query Functions ────────────────────────────────────────────────────────────

/**
 * Find progression and regression alternatives for an exercise.
 */
export function findProgressions(
  graph: ExerciseGraph,
  exerciseId: string,
  exercises: CompressedExercise[]
): { easier: CompressedExercise[]; harder: CompressedExercise[] } {
  const exerciseMap = new Map(exercises.map((e) => [e.id, e]))

  const easierIds = graph.relationships
    .filter((r) => r.exerciseId === exerciseId && r.type === "regression")
    .sort((a, b) => b.similarity - a.similarity)
    .map((r) => r.relatedId)

  const harderIds = graph.relationships
    .filter((r) => r.exerciseId === exerciseId && r.type === "progression")
    .sort((a, b) => b.similarity - a.similarity)
    .map((r) => r.relatedId)

  return {
    easier: easierIds.map((id) => exerciseMap.get(id)).filter((e): e is CompressedExercise => !!e),
    harder: harderIds.map((id) => exerciseMap.get(id)).filter((e): e is CompressedExercise => !!e),
  }
}

/**
 * Find alternative exercises that could substitute for the given exercise.
 */
export function findAlternatives(
  graph: ExerciseGraph,
  exerciseId: string,
  maxResults = 5
): string[] {
  return graph.relationships
    .filter(
      (r) =>
        r.exerciseId === exerciseId &&
        (r.type === "alternative" || r.type === "variation")
    )
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults)
    .map((r) => r.relatedId)
}

/**
 * Find antagonist exercises for superset pairing.
 */
export function findAntagonists(
  graph: ExerciseGraph,
  exerciseId: string,
  maxResults = 5
): string[] {
  return (graph.antagonistPairs.get(exerciseId) ?? []).slice(0, maxResults)
}

/**
 * Find the best matching progression chain for a slot specification.
 */
export function getProgressionChainForSlot(
  graph: ExerciseGraph,
  movementPattern: string,
  targetMuscles: string[],
  difficulty: string
): ProgressionChain | null {
  const candidates = graph.progressionChains
    .filter((chain) => chain.pattern === movementPattern)
    .map((chain) => ({
      chain,
      muscleOverlap: jaccard(chain.muscles, targetMuscles),
    }))
    .filter((c) => c.muscleOverlap > 0.3)
    .sort((a, b) => b.muscleOverlap - a.muscleOverlap)

  // Prefer chains that include the requested difficulty level
  for (const { chain } of candidates) {
    if (chain.exercises.some((e) => e.difficulty === difficulty)) {
      return chain
    }
  }

  return candidates[0]?.chain ?? null
}

/**
 * Suggest which exercise to use in each rotation block.
 */
export function suggestVariationExercises(
  graph: ExerciseGraph,
  currentExerciseId: string,
  blockIndex: number,
  totalBlocks: number
): string[] {
  if (blockIndex === 0) return [currentExerciseId]

  // Get alternatives and progressions
  const alternatives = findAlternatives(graph, currentExerciseId, totalBlocks)
  const progressions = graph.relationships
    .filter((r) => r.exerciseId === currentExerciseId && r.type === "progression")
    .sort((a, b) => a.similarity - b.similarity) // easier progressions first
    .map((r) => r.relatedId)

  // For later blocks, prefer progressions (increasing difficulty over time)
  const suggestions: string[] = []
  const progressionRatio = blockIndex / totalBlocks // 0→1 over blocks

  if (progressionRatio > 0.5 && progressions.length > 0) {
    // Later blocks: use progressions
    const idx = Math.min(
      Math.floor((blockIndex - 1) * progressions.length / (totalBlocks - 1)),
      progressions.length - 1
    )
    suggestions.push(progressions[idx])
  } else if (alternatives.length > 0) {
    // Earlier blocks: use alternatives
    const idx = Math.min(blockIndex - 1, alternatives.length - 1)
    suggestions.push(alternatives[idx])
  }

  // Fallback: if nothing found, return the current exercise
  if (suggestions.length === 0) {
    suggestions.push(currentExerciseId)
  }

  return suggestions
}

// ─── Prompt Formatting ──────────────────────────────────────────────────────────

/**
 * Format relevant graph relationships into a string for Agent 3's context.
 */
export function formatGraphContextForPrompt(
  graph: ExerciseGraph,
  relevantExerciseIds: string[],
  exercises: CompressedExercise[]
): string {
  const exerciseMap = new Map(exercises.map((e) => [e.id, e]))
  const relevantSet = new Set(relevantExerciseIds)
  const lines: string[] = [
    "EXERCISE RELATIONSHIPS (use these for intelligent selection):",
    "",
  ]

  // Relevant progression chains
  const relevantChains = graph.progressionChains.filter((chain) =>
    chain.exercises.some((e) => relevantSet.has(e.id))
  )

  if (relevantChains.length > 0) {
    lines.push("Progression Chains:")
    for (const chain of relevantChains.slice(0, 10)) {
      const exerciseList = chain.exercises
        .map((e) => `${e.name} (${e.difficulty}${e.difficulty_score ? `, score:${e.difficulty_score}` : ""})`)
        .join(" → ")
      lines.push(`  - ${chain.pattern} [${chain.muscles.join(", ")}]: ${exerciseList}`)
    }
    lines.push("")
  }

  // Relevant antagonist pairs
  const antagonistLines: string[] = []
  const seenPairs = new Set<string>()
  for (const id of relevantExerciseIds) {
    const antagonists = graph.antagonistPairs.get(id) ?? []
    for (const antId of antagonists) {
      const pairKey = [id, antId].sort().join("|")
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)

      const exA = exerciseMap.get(id)
      const exB = exerciseMap.get(antId)
      if (exA && exB && relevantSet.has(antId)) {
        antagonistLines.push(`  - ${exA.name} ↔ ${exB.name}`)
      }
    }
  }

  if (antagonistLines.length > 0) {
    lines.push("Antagonist Pairs (for supersets):")
    lines.push(...antagonistLines.slice(0, 15))
    lines.push("")
  }

  // Relevant alternatives
  const alternativeLines: string[] = []
  for (const id of relevantExerciseIds) {
    const alts = findAlternatives(graph, id, 4)
      .map((altId) => exerciseMap.get(altId)?.name)
      .filter((n): n is string => !!n)

    if (alts.length > 0) {
      const ex = exerciseMap.get(id)
      if (ex) {
        alternativeLines.push(`  - ${ex.name} alternatives: ${alts.join(", ")}`)
      }
    }
  }

  if (alternativeLines.length > 0) {
    lines.push("Alternatives (for rotation between blocks):")
    lines.push(...alternativeLines.slice(0, 15))
    lines.push("")
  }

  return lines.join("\n")
}
