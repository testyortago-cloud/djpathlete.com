import type { CompressedExercise } from "./types.js"

/**
 * Coach-facing quality checks on a finished week or day.
 *
 * These exist because the dedup verifier reports "0% repetition — PASS" on a
 * session that prescribes three hip-bridge variants, and because both models
 * benchmarked on 2026-09-21 (Fable 5.1 and GPT-6 Astra) prescribed REPS for
 * isometric holds — inconsistently, inside a single session, in the same run
 * that also got it right. Two different vendors making the same mistake is a
 * prompt problem, not a model problem, so the prompt now says it outright AND
 * these checks catch what still slips through.
 *
 * Everything here REPORTS. Nothing blocks or rewrites: an isometric with reps
 * is wrong, but only the coach knows whether "10 each side" meant ten 5-second
 * holds, and guessing a duration on their behalf would be worse than saying so.
 */

/** Units that mean "hold for a time" rather than "do this many". */
const DURATION_PATTERN = /\d\s*(s\b|sec|secs|second|seconds|m\b|min|mins|minute|minutes|:\d{2})/i

/**
 * Does this prescription read as a duration?
 *
 * Deliberately permissive — "30s", "30 sec", "5 min", "1:30" and
 * "30s each side" all count. A false POSITIVE here silently drops a real
 * warning, so anything ambiguous should read as a duration only when a unit is
 * actually present.
 */
export function looksLikeDuration(reps: string | null | undefined): boolean {
  if (!reps) return false
  return DURATION_PATTERN.test(reps)
}

export interface IsometricRepsIssue {
  slot_id: string
  exercise_name: string
  reps: string
}

/**
 * Isometric exercises prescribed with a rep count instead of a hold time.
 *
 * Keys off the EXERCISE's movement_pattern, not the slot's: the architect sets
 * reps before any exercise is chosen, so a rep-shaped prescription only becomes
 * wrong once the selector puts a hold into that slot.
 */
export function findIsometricRepsIssues(
  assignments: Array<{ slot_id: string; exercise_id: string }>,
  exercises: CompressedExercise[],
  repsBySlotId: Map<string, string | null | undefined>,
): IsometricRepsIssue[] {
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const issues: IsometricRepsIssue[] = []

  for (const a of assignments) {
    const ex = byId.get(a.exercise_id)
    if (!ex || ex.movement_pattern !== "isometric") continue
    const reps = repsBySlotId.get(a.slot_id)
    if (!reps) continue
    if (looksLikeDuration(reps)) continue
    issues.push({ slot_id: a.slot_id, exercise_name: ex.name, reps })
  }

  return issues
}

// ─── Repeated movement families ─────────────────────────────────────────────

const FAMILY_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "your",
  "use",
  "using",
  "from",
  "into",
  "onto",
  "per",
  "single",
  "double",
  "one",
  "two",
  "leg",
  "legs",
  "arm",
  "arms",
  "side",
  "sided",
  "left",
  "right",
  "alternating",
  "alt",
  "seated",
  "standing",
  "kneeling",
  "half",
  "long",
  "short",
  "wide",
  "close",
  "high",
  "low",
  "front",
  "back",
  "lateral",
])

function familyTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 3 && !FAMILY_STOPWORDS.has(t))
}

export interface MovementFamilyGroup {
  /** The shared tokens that make these the same movement, e.g. ["hip","bridge"]. */
  family: string[]
  exercise_names: string[]
}

/**
 * Exercises in ONE session that are the same movement wearing different names.
 *
 * The existing dedup verifier compares exercise_ids, so "Double leg hip bridge",
 * "Side hip bridge leg lift" and "hip bridge long lever" are three different
 * exercises to it and it reports 0% repetition. To an athlete they are three
 * sets of bridging.
 *
 * Two exercises are the same family when their names share at least
 * `minShared` significant tokens after stripping the words that describe a
 * VARIANT rather than a movement (single/double, left/right, seated/standing).
 * Stripping those is what makes "Double leg hip bridge" and "hip bridge long
 * lever" collapse onto ["hip","bridge"].
 */
export function findRepeatedMovementFamilies(exerciseNames: string[], minShared = 2): MovementFamilyGroup[] {
  const tokenSets = exerciseNames.map((n) => ({ name: n, tokens: new Set(familyTokens(n)) }))
  const groups = new Map<string, Set<string>>()

  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      const shared = [...tokenSets[i].tokens].filter((t) => tokenSets[j].tokens.has(t)).sort()
      if (shared.length < minShared) continue
      const key = shared.join(" ")
      const members = groups.get(key) ?? new Set<string>()
      members.add(tokenSets[i].name)
      members.add(tokenSets[j].name)
      groups.set(key, members)
    }
  }

  return [...groups.entries()]
    .map(([key, members]) => ({ family: key.split(" "), exercise_names: [...members] }))
    .filter((g) => g.exercise_names.length > 1)
}

// ─── Warning text ───────────────────────────────────────────────────────────

export function buildIsometricWarning(issues: IsometricRepsIssue[]): string[] {
  if (issues.length === 0) return []
  const example = issues[0]
  return [
    `${issues.length} hold${issues.length === 1 ? " is" : "s are"} prescribed with a rep count instead of a ` +
      `time — e.g. "${example.exercise_name}" says "${example.reps}" (slot ${example.slot_id}). ` +
      `An isometric is held for seconds; set a duration before the client sees it.`,
  ]
}

export function buildMovementFamilyWarning(dayLabel: string, groups: MovementFamilyGroup[]): string[] {
  if (groups.length === 0) return []
  const detail = groups.map((g) => `${g.exercise_names.join(" + ")} (all ${g.family.join(" ")})`).join("; ")
  return [
    `${dayLabel} repeats the same movement under different names: ${detail}. ` +
      `The duplicate check passes because these are separate exercises in the library, ` +
      `but the session trains one pattern several times.`,
  ]
}

export function buildHallucinatedIdWarning(count: number, dayLabel: string): string[] {
  if (count <= 0) return []
  return [
    `${count} exercise${count === 1 ? "" : "s"} the AI named ${count === 1 ? "does" : "do"} not exist in the ` +
      `library and ${count === 1 ? "was" : "were"} removed, so ${dayLabel} is ${count} exercise` +
      `${count === 1 ? "" : "s"} shorter than planned. Add ${count === 1 ? "a replacement" : "replacements"} by hand, ` +
      `or re-generate.`,
  ]
}
