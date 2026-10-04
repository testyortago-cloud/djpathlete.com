import { getSupabase } from "../lib/supabase.js"
import { splitSentences, cleanNote } from "./note-guard.js"

// ─── Supabase Helpers ──────────────────────────────────────────────────────

export async function getProgramById(id: string) {
  const supabase = getSupabase()
  const { data, error } = await supabase.from("programs").select("*").eq("id", id).single()
  if (error) throw new Error(`Program not found: ${error.message}`)
  return data
}

export async function getClientProfile(userId: string) {
  const supabase = getSupabase()
  const { data } = await supabase.from("client_profiles").select("*").eq("user_id", userId).single()
  return data
}

export async function getClientName(userId: string): Promise<string> {
  const supabase = getSupabase()
  const { data } = await supabase.from("users").select("first_name, last_name").eq("id", userId).single()
  return data ? `${data.first_name} ${data.last_name}`.trim() : "Client"
}

export async function bulkAddExercisesToProgram(rows: Record<string, unknown>[], retries = 3) {
  const BATCH_SIZE = 25
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    for (let attempt = 1; attempt <= retries; attempt++) {
      const supabase = getSupabase()
      const { error } = await supabase.from("program_exercises").insert(batch)
      if (!error) break
      if (attempt === retries)
        throw new Error(`Failed to add exercises (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${error.message}`)
      console.warn(
        `[shared] bulkAddExercises batch ${Math.floor(i / BATCH_SIZE) + 1} attempt ${attempt} failed: ${error.message}, retrying...`,
      )
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
}

// ─── Injury Joint Extraction ───────────────────────────────────────────────

const JOINT_KEYWORDS: Record<string, string> = {
  knee: "knee",
  ankle: "ankle",
  hip: "hip",
  shoulder: "shoulder",
  elbow: "elbow",
  wrist: "wrist",
  lower_back: "lumbar_spine",
  "lower back": "lumbar_spine",
  lumbar: "lumbar_spine",
  back: "thoracic_spine",
  thoracic: "thoracic_spine",
  spine: "lumbar_spine",
}

export function extractInjuredJoints(injuryDetails: Array<{ area?: string }> | null | undefined): string[] {
  const injuredJoints: string[] = []
  if (!injuryDetails?.length) return injuredJoints

  for (const injury of injuryDetails) {
    const area = injury.area?.toLowerCase() ?? ""
    for (const [keyword, joint] of Object.entries(JOINT_KEYWORDS)) {
      if (area.includes(keyword) && !injuredJoints.includes(joint)) {
        injuredJoints.push(joint)
      }
    }
  }
  return injuredJoints
}

// ─── Coach Instructions Formatting ─────────────────────────────────────────

export function buildCoachInstructionsSection(instructions: string | undefined): string {
  if (!instructions) return ""
  return `\n\n## COACH INSTRUCTIONS (ladder rank 3 — above every default, below safety)\n${instructions}\n\nYou MUST follow these instructions exactly. They override every default rule (ladder ranks 4-6), including:
- **Structure**: If the coach specifies exercise counts (e.g., "4 power exercises", "2 quad exercises", "3 compounds and 2 accessories"), create exactly that many slots with the matching roles/patterns. Do NOT add extra slots or ignore the counts.
- **Periodization**: If the coach requests deload weeks, specific phases, or intensity patterns (e.g., "deload on week 4", "first 2 weeks hypertrophy then strength"), structure the program exactly as described.
- **Technique**: If the coach names a set technique (e.g., "no supersets", "use circuits", "use cluster sets", "rest-pause on compounds", "wave loading"), apply EXACTLY that technique even if default rules would suggest otherwise. Do not silently substitute supersets or straight sets because they are more familiar — if the coach asked for cluster sets, the program uses cluster sets.
- **Exercise focus**: If the coach requests specific focus areas, muscle groups, or movement patterns, prioritize those in slot design and exercise selection.
- **Session design**: If the coach specifies session structure (e.g., "start with plyometrics", "finish with core"), follow that order.
- **Never overridden by these**: injury exclusions, the coach's explicit equipment setting, blocked exercises, and the exercise library itself.

The coach knows this athlete. When in doubt, follow the coach's intent over any default in this prompt.`
}

// ─── Exercise Pool ─────────────────────────────────────────────────────────

export type PoolMode = "preferred" | "strict"

/**
 * Build the system note describing how the AI should treat the Exercise Pool.
 * - "strict"    → pool is the only allowed library (hard restriction)
 * - "preferred" → pool is a strong guideline; AI may reach outside when no
 *                 pool exercise fits a slot. This is the default.
 */
export function buildPoolNote(
  poolIds: string[] | undefined,
  filteredCount: number,
  mode: PoolMode = "preferred",
  poolCount?: number,
  /**
   * The pool's own rows. The library the selector reads carries no pool marker,
   * so without this list "prefer the pool" names exercises it cannot identify —
   * which is how a 2026-10-01 replay left two of six picks out every time.
   */
  poolExercises?: Array<{ id: string; name: string }>,
): string {
  if (!poolIds || poolIds.length === 0) return ""
  if (mode === "strict") {
    return `\n\nNOTE: The exercise library has been pre-filtered to a coach-curated Exercise Pool of ${filteredCount} exercises. You MUST select from these exercises ONLY. If a slot cannot be perfectly matched, pick the closest available exercise from the pool. Do NOT reference exercises outside this list.`
  }
  // Preferred (guideline) mode
  const total = poolCount ?? poolIds.length
  const list =
    poolExercises && poolExercises.length > 0
      ? `\nThe pool (exercise_id — name):\n${poolExercises.map((e) => `- ${e.id} — ${e.name}`).join("\n")}\nThe coach picked these for this client, so use them regardless of their difficulty rating.`
      : ""
  return `\n\nNOTE: The coach has curated an Exercise Pool of ${total} preferred exercises. These are STRONGLY PREFERRED — fill every slot from this pool when a pool exercise reasonably matches the slot's movement_pattern, target_muscles, and role. You MAY pick an exercise from outside the pool ONLY when no pool exercise is a sensible fit for the slot — in that case, add a substitution_note explaining why no pool option fit. AIM to use as many DIFFERENT pool exercises as possible across the week — do not duplicate pool exercises while ignoring others that fit.${list}`
}

/**
 * Apply the Exercise Pool to the candidate library.
 * - "strict"    → physically filter the library down to the pool.
 * - "preferred" → return the full library unchanged. Pool IDs are surfaced as
 *                 a scoring boost (see FilterOptions.preferredIds) and as
 *                 prompt guidance, but candidates outside the pool remain
 *                 available as fallback. This is the default.
 */
export function applyPoolFilter<T extends { id: string }>(
  fullLibrary: T[],
  poolIds: string[] | undefined,
  logPrefix: string,
  mode: PoolMode = "preferred",
): T[] {
  if (!poolIds || poolIds.length === 0) return fullLibrary
  if (mode === "preferred") {
    console.log(
      `[${logPrefix}] Exercise Pool active in PREFERRED mode — biasing toward ${poolIds.length} pool exercises (full library of ${fullLibrary.length} remains available as fallback)`,
    )
    return fullLibrary
  }
  const poolSet = new Set(poolIds)
  const filtered = fullLibrary.filter((e) => poolSet.has(e.id))
  console.log(
    `[${logPrefix}] Exercise Pool active in STRICT mode — using ${filtered.length}/${fullLibrary.length} exercises`,
  )
  return filtered
}

/**
 * The ids that bypass the GUESS-based difficulty and equipment filters: the
 * exercises the coach named in their instructions, plus a Preferred pool.
 *
 * A pool is the coach's own pick for this client, exactly like naming an
 * exercise, and a guess ("intermediate" with no profile, "no equipment" with no
 * client) must not outrank it. Before 2026-10-01 a pool exercise those guesses
 * removed was gone before semanticFilterExercises' pool rescue ran, which
 * re-injects only from the survivors — a 6-exercise pool reached the AI as zero.
 * Callers still pass the plain unlocked set where the coach's equipment setting
 * is explicit (an override or a typed restriction): that is an answer, not a guess.
 */
export function withPreferredPool(unlockedIds: Set<string>, preferredIds: Set<string> | undefined): Set<string> {
  if (!preferredIds || preferredIds.size === 0) return unlockedIds
  return new Set([...unlockedIds, ...preferredIds])
}

/**
 * The program history the variety rules read, minus the coach's Exercise Pool.
 *
 * The cross-day exclusion set, the selector's AVOID list and the cross-week
 * verifier (which turns a repeat into a retry) are all built from this history.
 * A coach who picks the same pool every week wants those exercises every week,
 * so a pool exercise must never be "too recent" to use. Blocks and bans are
 * separate inputs and still apply.
 */
export function withoutPoolHistory<T extends { exercise_id?: unknown }>(rows: T[], poolIds: string[] | undefined): T[] {
  if (!poolIds || poolIds.length === 0) return rows
  const pool = new Set(poolIds)
  return rows.filter((r) => !pool.has(String(r.exercise_id)))
}

/** A phrase matching more library exercises than this is a broad word ("jumps"), not a request. */
const SPECIFIC_NAMED_MAX = 8

/**
 * The exercises a coach asked for SPECIFICALLY, exempt from the variety history
 * the way a pool is (withoutPoolHistory): "Include box jumps" every week means
 * box jumps every week, not "anything but last week's box jumps". A broad
 * phrase has plenty of alternatives and stays under the variety rule.
 */
export function specificNamedIds(groups: Array<{ phrase: string; exercise_ids: string[] }>): string[] {
  const ids = new Set<string>()
  for (const g of groups) {
    if (g.exercise_ids.length <= SPECIFIC_NAMED_MAX) for (const id of g.exercise_ids) ids.add(id)
  }
  return [...ids]
}

/** Exercises listed per group in the selector note — enough to choose a fit. */
const NAMED_LISTED_PER_GROUP = 5

/**
 * The selector's half of a coach-named exercise. Unlocking it past the filters
 * is not asking for it: the library the selector reads carries no "the coach
 * named this" marker, so until 2026-10-02 nothing told it which exercises
 * "Include: box jumps, med ball slams" meant (the 2026-10-01 pool bug, again).
 * Lists only exercises actually offered; a group with none is left out — the
 * instruction check reports it as not met, which is the truth.
 */
export function buildNamedNote(
  groups: Array<{ phrase: string; exercise_ids: string[] }>,
  offered: Array<{ id: string; name: string }>,
  scope: "day" | "week",
): string {
  const byId = new Map(offered.map((e) => [e.id, e]))
  const lines: string[] = []
  for (const g of groups) {
    const present = g.exercise_ids
      .map((id) => byId.get(id))
      .filter((e): e is { id: string; name: string } => !!e)
      .slice(0, NAMED_LISTED_PER_GROUP)
    if (present.length === 0) continue
    lines.push(`- "${g.phrase}": ${present.map((e) => `${e.id} — ${e.name}`).join("; ")}`)
  }
  if (lines.length === 0) return ""
  return (
    `\n\nCOACH-NAMED EXERCISES: the coach asked for these by name. Place at least one exercise from EACH group ` +
    `below across the ${scope}, in a slot whose role and movement pattern fit it (jumps, throws and slams go in ` +
    `power slots). They take priority over similar library exercises. (group: exercise_id — name)\n${lines.join("\n")}`
  )
}

/**
 * The architect's half of a PREFERRED pool. The selector is told to fill slots
 * from the pool "when a pool exercise reasonably matches the slot", which it
 * cannot do if no slot matches: on 2026-10-01 the architect, told nothing about
 * a preferred pool, planned a shoulder day and all six of the coach's lunge and
 * squat picks were offered to the selector and left out. Strict mode has its
 * own, harder section (buildPoolPatternSection).
 */
export function buildPreferredPoolPlanSection(
  pool: Array<{ name?: string; movement_pattern?: string | null; primary_muscles?: string[] | null }>,
): string {
  if (pool.length === 0) return ""
  const list = pool
    .map(
      (e) =>
        `- ${e.name ?? "?"} (${e.movement_pattern ?? "unspecified"}; ${(e.primary_muscles ?? []).join(", ") || "unspecified"})`,
    )
    .join("\n")
  return `\n\n## COACH'S EXERCISE POOL (PREFERRED)
The coach picked these ${pool.length} exercises for this session. Plan a slot that each of these exercises fits — its movement_pattern, target muscles and a suitable role — unless the coach's instructions rule one out. Plan the remaining slots as you normally would:
${list}`
}

/**
 * Coach-facing notices for a PREFERRED pool. Strict mode has its own (the pool is
 * the whole library there); in preferred mode a pool that never reached the AI,
 * or one the AI ignored, used to be silent.
 */
export function buildPreferredPoolWarnings(args: {
  poolIds: string[]
  /** Ids in the library actually handed to the selector. */
  offeredIds: Set<string>
  /** Exercise ids in the finished assignment. */
  usedIds: Set<string>
  /** The hard-prune set: nearby-week variety, coach bans and blocks. */
  excludedIds: Set<string>
  nameById: Map<string, string>
  scopeLabel: string
}): string[] {
  const { poolIds, offeredIds, usedIds, excludedIds, nameById, scopeLabel } = args
  const pool = [...new Set(poolIds)]
  if (pool.length === 0) return []
  const warnings: string[] = []

  const notOffered = pool.filter((id) => !offeredIds.has(id))
  if (notOffered.length > 0) {
    const detail = notOffered
      .map(
        (id) =>
          `${nameById.get(id) ?? "an exercise no longer in the library"} (${
            excludedIds.has(id)
              ? "used in a nearby week, or blocked"
              : "excluded by an equipment setting, the client's injuries, or no longer in the library"
          })`,
      )
      .join("; ")
    warnings.push(
      `${notOffered.length} of your ${pool.length} Exercise Pool exercises were not offered to the AI for ${scopeLabel}: ${detail}.`,
    )
  }

  const offered = pool.filter((id) => offeredIds.has(id))
  const used = pool.filter((id) => usedIds.has(id))
  if (offered.length > 0 && used.length === 0) {
    warnings.push(
      `The AI used none of your ${pool.length} Exercise Pool exercises for ${scopeLabel}. Turn on Strict pool to use only those exercises.`,
    )
  } else {
    const offeredUnused = offered.filter((id) => !usedIds.has(id))
    if (offeredUnused.length > 0) {
      warnings.push(
        `The AI used ${used.length} of your ${pool.length} Exercise Pool exercises for ${scopeLabel}. ` +
          `Not used: ${offeredUnused.map((id) => nameById.get(id) ?? id).join("; ")}.`,
      )
    }
  }
  return warnings
}

// ─── Firebase Job Progress ─────────────────────────────────────────────────

/**
 * Publish job progress to BOTH Firestore and RTDB.
 *
 * Firestore is the transport browsers actually receive: RTDB's
 * `wss://*.firebaseio.com` stream silently fails to deliver in some
 * browser/network setups (see JobsNotificationDock, which was migrated to
 * Firestore for exactly this reason). Progress written only to RTDB left the
 * import dialogs frozen at "Step 0 of 3" while the job ran to completion.
 *
 * The two writes are independent — a failure of one must neither block nor
 * hide the other, so neither is allowed to throw out of here.
 */
export function createJobProgressUpdater(firebaseJobId: string | undefined, totalSteps: number) {
  return async function updateJobProgress(step: string, currentStep: number, detail?: string) {
    if (!firebaseJobId) return
    const progress = { status: step, current_step: currentStep, total_steps: totalSteps, detail: detail ?? null }

    const [firestoreResult, rtdbResult] = await Promise.allSettled([
      (async () => {
        const { getFirestore } = await import("firebase-admin/firestore")
        // set/merge rather than update: never throw merely because the doc
        // is not there yet.
        await getFirestore().collection("ai_jobs").doc(firebaseJobId).set({ progress }, { merge: true })
      })(),
      (async () => {
        const { getDatabase } = await import("firebase-admin/database")
        await getDatabase().ref(`ai_jobs/${firebaseJobId}`).update({ progress, updatedAt: Date.now() })
      })(),
    ])

    if (firestoreResult.status === "rejected") {
      console.warn(`[shared] Failed to update Firestore progress:`, firestoreResult.reason)
    }
    if (rtdbResult.status === "rejected") {
      console.warn(`[shared] Failed to update RTDB progress:`, rtdbResult.reason)
    }
  }
}

export function createCancellationChecker(firebaseJobId: string | undefined) {
  return async function checkCancelled(): Promise<boolean> {
    if (!firebaseJobId) return false
    try {
      const { getFirestore } = await import("firebase-admin/firestore")
      const db = getFirestore()
      const snap = await db.collection("ai_jobs").doc(firebaseJobId).get()
      return snap.exists && snap.data()?.status === "cancelled"
    } catch {
      return false
    }
  }
}

// ─── Exclude-ID Set Building ───────────────────────────────────────────────

import type { PriorWeekContext } from "./dedup-verify.js"

/**
 * Compute the exercise IDs to physically remove from the candidate library
 * for a generation. Filters the context's excluded set down to variety roles
 * actually being generated. Anchor roles (warm_up/cool_down) are never excluded.
 */
export function buildExcludeIdSet(
  priorContext: PriorWeekContext,
  slotRolesInScope: Set<string>,
): Set<string> {
  const out = new Set<string>()
  for (const [groupKey, ids] of priorContext.used_accessory_exercises) {
    const role = groupKey.split("|")[0]
    if (!slotRolesInScope.has(role)) continue
    for (const id of ids) out.add(id)
  }
  return out
}

/**
 * Resolve the cross-day/cross-week variety exclusion set, mode-aware.
 *
 * In STRICT pool mode the coach deliberately curated a (often small) set, and
 * expects its exercises to recur across days. Hard-pruning everything already
 * used elsewhere in the program can starve that pool down to one or two
 * candidates per day — producing duplicate-laden days or empty-selection
 * failures. So we skip cross-day exclusion entirely in strict mode; within-day
 * dedup still guarantees each day's working slots stay distinct.
 *
 * In preferred/normal mode the full library is available, so cross-day variety
 * exclusion stays on.
 */
export function resolveCrossDayExcludeIds(
  priorContext: PriorWeekContext,
  slotRolesInScope: Set<string>,
  poolActive: boolean,
): Set<string> {
  if (poolActive) return new Set<string>()
  return buildExcludeIdSet(priorContext, slotRolesInScope)
}

// ─── Exclusion planning ───────────────────────────────────────────────────

export interface ExclusionPlanInput<T extends { id: string }> {
  /** The candidate library at the point exclusions are applied. */
  candidates: T[]
  /** Cross-day variety exclusions — already relaxed for strict pool upstream. */
  crossDayExcludeIds: Iterable<string>
  /** Exercises the coach named as exclusions in THIS run's instructions. */
  instructionBannedIds: Iterable<string>
  /** The coach's persistent blocklist — studio-wide plus this client's. */
  blockedIds: Iterable<string>
  poolActive: boolean
}

export interface ExclusionPlan<T extends { id: string }> {
  /** The hard-prune set handed to the exercise filter. */
  excludeIds: Set<string>
  /**
   * What the selector will actually be able to choose from. Generic so the
   * caller keeps the full exercise shape — the starvation re-route downstream
   * reads `movement_pattern` off these, and an `{ id }`-only type would silently
   * hand it objects with no pattern at all.
   */
  candidates: T[]
  /** True when a strict pool has been emptied by exclusions — a dead end. */
  poolExhausted: boolean
}

/**
 * Fold the three exclusion sources into one hard-prune set and report what
 * survives it.
 *
 * This exists as its own function because the ORDER of these operations is the
 * load-bearing part and it was wrong before the blocklist arrived:
 *
 * - The strict-pool "no usable exercises" guard used to measure the library
 *   BEFORE exclusions, so a pool emptied by exclusions passed the guard and
 *   died later with a much worse error.
 * - The starvation re-route was likewise handed the pre-exclusion library, so
 *   it could not see the empty pattern it exists to absorb.
 *
 * Blocks are deliberately NOT relaxed for strict pool mode the way cross-day
 * variety exclusion is. A block is an explicit standing instruction from the
 * coach and outranks the pool: the pool says "prefer these", a block says
 * "never this". Relaxing blocks under a pool would silently reinstate the
 * exercise the coach went out of their way to ban.
 */
export function planExclusions<T extends { id: string }>(input: ExclusionPlanInput<T>): ExclusionPlan<T> {
  const excludeIds = new Set<string>([
    ...input.crossDayExcludeIds,
    ...input.instructionBannedIds,
    ...input.blockedIds,
  ])
  const candidates = input.candidates.filter((e) => !excludeIds.has(e.id))
  return {
    excludeIds,
    candidates,
    poolExhausted: input.poolActive && candidates.length === 0,
  }
}

// ─── Candidate Equipment / Pattern-Coverage Helpers ───────────────────────

import type { CompressedExercise } from "./types.js"
import { filterByAvailableEquipment } from "./exercise-context.js"

/**
 * Equipment hard-filter for the candidate library, mode-aware.
 *
 * In STRICT pool mode the coach hand-picked these exercises, so honor the pool
 * over the client's equipment profile — which is empty on unassigned template
 * programs and would otherwise collapse the pool to bodyweight-only exercises.
 * In preferred/normal mode, enforce equipment availability as before so the
 * candidate set matches what the client can actually perform.
 *
 * `strict` (an explicit per-generation equipment override) beats the pool
 * bypass. A curated pool is a preference; "they are in a hotel room this week"
 * is a fact about the world, and a pool assembled before the trip cannot know
 * about it. The coach still sees a warning naming every pool exercise dropped.
 */
export function filterCandidateEquipment(
  exercises: CompressedExercise[],
  availableEquipment: string[],
  poolActive: boolean,
  unlockedIds?: Set<string>,
  strict = false,
): CompressedExercise[] {
  if (poolActive && !strict) return exercises
  return filterByAvailableEquipment(exercises, availableEquipment, unlockedIds, strict)
}

/**
 * Movement patterns the skeleton requires that NO candidate exercise can fill.
 *
 * Used to fail loudly in strict pool mode: rather than letting the selector cram
 * a non-matching exercise into the slot (with a cosmetic "perform as X" note) or
 * return an empty selection that surfaces as a cryptic Zod error, we surface an
 * actionable message naming the patterns the coach's pool is missing.
 */
export function findUncoveredPatterns(
  weeks: ProgramWeek[],
  candidates: Array<{ movement_pattern?: string | null }>,
): string[] {
  const available = new Set<string>()
  for (const c of candidates) if (c.movement_pattern) available.add(c.movement_pattern)
  const missing = new Set<string>()
  for (const week of weeks) {
    for (const day of week.days) {
      for (const slot of day.slots) {
        if (!available.has(slot.movement_pattern)) missing.add(slot.movement_pattern)
      }
    }
  }
  return [...missing]
}

/**
 * Nearest-neighbor substitutes per movement pattern, most-similar first.
 * Used to coerce architect-planned patterns onto what a strict pool actually
 * contains, so a curated pool never hard-fails generation just because the
 * architect dreamed up a pattern (carry, locomotion, …) the pool lacks.
 */
const PATTERN_NEIGHBORS: Record<string, string[]> = {
  push: ["pull", "isometric", "squat", "conditioning"],
  pull: ["push", "hinge", "isometric", "rotation"],
  squat: ["lunge", "hinge", "push", "isometric"],
  hinge: ["squat", "lunge", "pull", "isometric"],
  lunge: ["squat", "hinge", "locomotion", "isometric"],
  carry: ["hinge", "isometric", "locomotion", "pull"],
  rotation: ["isometric", "pull", "push", "carry"],
  isometric: ["rotation", "carry", "squat", "push"],
  locomotion: ["conditioning", "lunge", "carry", "squat"],
  conditioning: ["locomotion", "squat", "push", "lunge"],
}

export interface PatternRemap {
  slot_id: string
  from: string
  to: string
}

/**
 * The set of movement patterns a candidate library can actually fill, plus the
 * single most-represented pattern (used as a last-resort remap target).
 */
export function availablePatterns(candidates: Array<{ movement_pattern?: string | null }>): {
  patterns: Set<string>
  mostCommon: string | null
} {
  const counts = new Map<string, number>()
  for (const c of candidates) {
    if (!c.movement_pattern) continue
    counts.set(c.movement_pattern, (counts.get(c.movement_pattern) ?? 0) + 1)
  }
  let mostCommon: string | null = null
  let best = 0
  for (const [p, n] of counts) {
    if (n > best) {
      best = n
      mostCommon = p
    }
  }
  return { patterns: new Set(counts.keys()), mostCommon }
}

/**
 * Remap skeleton slots whose movement_pattern the candidate pool cannot fill to
 * the nearest pattern the pool DOES cover (falling back to the pool's most
 * common pattern). Strict-pool mode only: the coach curated a deliberately
 * small set, so the day must be built FROM the pool rather than failing
 * against an idealized split. Mutates `weeks` in place; returns the remaps
 * made for logging. No-op when the pool has no patterned exercises at all.
 */
export function remapUncoveredSlotPatterns(
  weeks: ProgramWeek[],
  candidates: Array<{ movement_pattern?: string | null }>,
): PatternRemap[] {
  const { patterns, mostCommon } = availablePatterns(candidates)
  if (patterns.size === 0 || !mostCommon) return []

  const remaps: PatternRemap[] = []
  for (const week of weeks) {
    for (const day of week.days) {
      for (const slot of day.slots) {
        if (patterns.has(slot.movement_pattern)) continue
        const neighbors = PATTERN_NEIGHBORS[slot.movement_pattern] ?? []
        const to = neighbors.find((p) => patterns.has(p)) ?? mostCommon
        remaps.push({ slot_id: slot.slot_id, from: slot.movement_pattern, to })
        slot.movement_pattern = to as ExerciseSlot["movement_pattern"]
      }
    }
  }
  return remaps
}

/**
 * Architect-message section describing what a strict pool can cover, so the
 * architect designs slots the pool can actually fill instead of an idealized
 * split that hard-fails downstream. Empty string outside strict pool mode.
 */
export function buildPoolPatternSection(
  candidates: Array<{ name?: string; movement_pattern?: string | null }>,
  poolActive: boolean,
): string {
  if (!poolActive || candidates.length === 0) return ""
  const { patterns } = availablePatterns(candidates)
  if (patterns.size === 0) return ""
  const list = candidates
    .slice(0, 40)
    .map((c) => `${c.name ?? "?"} (${c.movement_pattern ?? "unspecified"})`)
    .join(", ")
  return `\n\n## STRICT EXERCISE POOL (HARD CONSTRAINT)
The coach restricted this generation to a curated pool of ${candidates.length} exercises. The pool ONLY covers these movement patterns: ${[...patterns].join(", ")}.
Every slot's movement_pattern MUST be one of those values — do NOT plan slots for any other movement pattern (locomotion, carry, etc. have NO matching exercise and would make the day impossible to fill). Design the day FROM this pool:
${list}${candidates.length > 40 ? `, … and ${candidates.length - 40} more` : ""}`
}

// ─── Slot Lookup Building ──────────────────────────────────────────────────

import type { ExerciseSlot, ProgramWeek } from "./types.js"

interface SlotLocation {
  week_number: number
  day_of_week: number
  order_index: number
}

interface SlotDetails {
  sets: number
  reps: string
  rest_seconds: number
  rpe_target: number | null
  tempo: string | null
  group_tag: string | null
  technique: ExerciseSlot["technique"]
  role: ExerciseSlot["role"]
  intensity_pct: number | null
}

export function buildSlotLookups(weeks: ProgramWeek[]) {
  const slotLookup = new Map<string, SlotLocation>()
  const slotDetailsLookup = new Map<string, SlotDetails>()

  for (const week of weeks) {
    for (const day of week.days) {
      day.slots.forEach((slot, idx) => {
        slotLookup.set(slot.slot_id, {
          week_number: week.week_number,
          day_of_week: day.day_of_week,
          order_index: idx,
        })
        slotDetailsLookup.set(slot.slot_id, {
          sets: slot.sets,
          reps: slot.reps,
          rest_seconds: slot.rest_seconds,
          rpe_target: slot.rpe_target,
          tempo: slot.tempo,
          group_tag: slot.group_tag,
          technique: slot.technique ?? "straight_set",
          role: slot.role,
          intensity_pct: slot.intensity_pct ?? null,
        })
      })
    }
  }

  return { slotLookup, slotDetailsLookup }
}

// ─── Skeleton Day De-duplication ───────────────────────────────────────────

export interface DayReassignment {
  week_number: number
  from_day: number
  to_day: number
}

/**
 * Guarantee every week in a skeleton has unique day_of_week values. Agent 2
 * (the architect) occasionally emits two days with the same day_of_week. Since
 * slot_ids are stamped as `w{week}d{day}s{idx}`, two days sharing a day_of_week
 * collide on slot_ids and collapse onto one calendar day — producing a single
 * day with doubled order_index (two days' worth of exercises stacked together).
 *
 * For each collision, the later day is reassigned to the lowest day_of_week
 * (1-7) not already used that week, and its slot_ids are regenerated to match.
 * Must run BEFORE slot lookups / exercise selection. Mutates `skeleton` in
 * place; returns the reassignments made (for logging). No-op for clean weeks.
 */
export function dedupeSkeletonDaysInPlace(skeleton: { weeks: ProgramWeek[] }): DayReassignment[] {
  const reassignments: DayReassignment[] = []

  for (const week of skeleton.weeks) {
    const used = new Set<number>()
    for (const day of week.days) {
      if (!used.has(day.day_of_week)) {
        used.add(day.day_of_week)
        continue
      }

      // Collision — find the lowest free weekday (1-7) not yet used this week.
      let free = -1
      for (let d = 1; d <= 7; d++) {
        if (!used.has(d)) {
          free = d
          break
        }
      }
      if (free === -1) {
        // All 7 weekdays already used (8+ days in a week) — leave as-is rather
        // than invent an out-of-range day. Vanishingly unlikely in practice.
        used.add(day.day_of_week)
        continue
      }

      reassignments.push({ week_number: week.week_number, from_day: day.day_of_week, to_day: free })
      day.day_of_week = free
      used.add(free)
      // Regenerate slot_ids so they stay unique and consistent with the new day.
      day.slots = day.slots.map((slot, idx) => ({ ...slot, slot_id: `w${week.week_number}d${free}s${idx + 1}` }))
    }
  }

  return reassignments
}

const VALID_TECHNIQUES = new Set([
  "straight_set",
  "superset",
  "dropset",
  "giant_set",
  "circuit",
  "rest_pause",
  "amrap",
  "cluster_set",
  "complex",
  "emom",
  "wave_loading",
])

// Internal slot ids (w2d1s9) that the selector sometimes writes into notes —
// meaningless to clients, so replace them with the exercise NAME assigned to
// that slot (or a generic phrase when the slot isn't in this batch).
const SLOT_REF_RE = /\bw\d{1,2}d\d{1,2}s\d{1,2}\b/gi
// Parenthesized exercise-id fragments the selector copies from the AVOID list,
// e.g. "(81e06b26)" or a full UUID — pure noise to clients, strip entirely.
// The short 8-char form requires at least one hex LETTER so legitimate
// parenthesized numbers ("(20260713)") survive.
const ID_FRAGMENT_RE = /\s*\((?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|(?=[0-9]*[a-f])[0-9a-f]{8})\)/gi

// Pipeline internals the selector narrates when it can't satisfy a constraint —
// pool size, library contents, positional slot numbers, its own substitution
// bookkeeping. These are TRUE and useful to the coach, but they are written into
// a field the CLIENT reads in their workout. Real example that shipped to a
// client (Matthew C, week 3):
//
//   "IMPORTANT: This slot has been assigned the same exercise as Slot 2 due to
//    the limited exercise pool (only 5 exercises available, with no other
//    lunge-pattern quad/adductor exercise in the library). See substitution notes."
//
// Matched sentences are removed from the note and handed back to the caller so
// the coach still sees them, in the generation warnings.
//
// Deliberately narrow: each alternative names an AI-pipeline concept, so a
// coaching sentence can't trip it. "pool" alone is not enough — an athlete may
// legitimately train in a swimming pool.
const PIPELINE_INTERNALS_RE =
  /(exercise pool|exercise library|in the library|from the library|only \d+ exercises?|limited (?:exercise )?(?:pool|library)|\bslots? \d+|substitution notes?|same exercise as|duplicate of)/i

/**
 * Remove any sentence that narrates AI-pipeline internals.
 * Returns the client-safe text plus the sentences removed (trimmed), so the
 * caller can surface them to the coach instead of losing them.
 */
export function stripPipelineInternals(notes: string): { text: string; stripped: string[] } {
  if (!PIPELINE_INTERNALS_RE.test(notes)) return { text: notes, stripped: [] }

  const kept: string[] = []
  const stripped: string[] = []
  for (const sentence of splitSentences(notes)) {
    if (PIPELINE_INTERNALS_RE.test(sentence)) stripped.push(sentence.trim())
    else kept.push(sentence)
  }
  return { text: kept.join("").replace(/\s{2,}/g, " ").trim(), stripped }
}

/** "8" + per_side → "8 each side". Leaves reps that already name a side alone. */
export function withSide(reps: string, perSide: boolean | undefined): string {
  if (!perSide) return reps
  if (/\b(?:each|per)\s+(?:side|leg|arm)\b|\/\s*side\b/i.test(reps)) return reps
  return `${reps} each side`
}

export interface RowBuildOptions {
  /** Library names by exercise id. The model's exercise_name is never trusted (2026-10-04). */
  nameById?: Map<string, string>
  /** normalizeSport()'d. null = no sport known: every sport sentence is removed. */
  athleteSport?: string | null
  /** Sentences note-guard removed — console only, not a coach warning. */
  onCleanedNote?: (slotId: string, sentences: string[]) => void
}

export function sanitizeSlotRefsInNotes(
  notes: string | null,
  nameBySlotId: Map<string, string>,
  /** Collects sentences removed for narrating pipeline internals. */
  onStripped?: (sentences: string[]) => void,
  athleteSport: string | null = null,
  onCleaned?: (sentences: string[]) => void,
): string | null {
  if (!notes) return notes
  const deInternalised = stripPipelineInternals(notes)
  if (deInternalised.stripped.length > 0) onStripped?.(deInternalised.stripped)
  const guarded = cleanNote(deInternalised.text, { athleteSport })
  if (guarded.stripped.length > 0) onCleaned?.(guarded.stripped)
  if (guarded.text === null) return null

  const cleaned = guarded.text
    .replace(SLOT_REF_RE, (ref) => nameBySlotId.get(ref.toLowerCase()) ?? "the paired exercise")
    .replace(ID_FRAGMENT_RE, "")
  if (cleaned === notes) return notes
  // Stripping a fragment can leave doubled spaces or a leading/trailing gap.
  // An note that was ENTIRELY internals becomes empty — store null, not "".
  const trimmed = cleaned.replace(/ {2,}/g, " ").trim()
  return trimmed.length > 0 ? trimmed : null
}

export function buildExerciseRows(
  assignments: Array<{
    slot_id: string
    exercise_id: string
    notes: string | null
    exercise_name?: string
    per_side?: boolean
  }>,
  slotLookup: Map<string, SlotLocation>,
  slotDetailsLookup: Map<string, SlotDetails>,
  programId: string,
  /** Receives note sentences removed for narrating pipeline internals. */
  onStrippedNote?: (slotId: string, sentences: string[]) => void,
  opts: RowBuildOptions = {},
): Record<string, unknown>[] {
  const nameBySlotId = new Map<string, string>()
  for (const a of assignments) {
    const libraryName = opts.nameById?.get(a.exercise_id)
    if (libraryName && a.exercise_name && libraryName !== a.exercise_name) {
      console.warn(`[rows] model named ${a.exercise_id} "${a.exercise_name}"; library says "${libraryName}"`)
    }
    const name = libraryName ?? a.exercise_name
    if (name) nameBySlotId.set(a.slot_id.toLowerCase(), name)
  }
  return assignments
    .map((assigned) => {
      const location = slotLookup.get(assigned.slot_id)
      const details = slotDetailsLookup.get(assigned.slot_id)
      if (!location || !details) return null
      return {
        program_id: programId,
        exercise_id: assigned.exercise_id,
        day_of_week: location.day_of_week,
        week_number: location.week_number,
        order_index: location.order_index,
        sets: details.sets,
        reps: withSide(details.reps, assigned.per_side),
        duration_seconds: null,
        rest_seconds: details.rest_seconds,
        notes: sanitizeSlotRefsInNotes(
          assigned.notes,
          nameBySlotId,
          (sentences) => onStrippedNote?.(assigned.slot_id, sentences),
          opts.athleteSport ?? null,
          (sentences) => opts.onCleanedNote?.(assigned.slot_id, sentences),
        ),
        rpe_target: details.rpe_target,
        intensity_pct: details.intensity_pct,
        tempo: details.tempo,
        group_tag: details.group_tag,
        technique: VALID_TECHNIQUES.has(details.technique ?? "") ? details.technique : "straight_set",
        slot_role: details.role,
      }
    })
    .filter((r) => r !== null) as Record<string, unknown>[]
}

// ─── Effective equipment (precedence) ───────────────────────────────────────

export interface EffectiveEquipment {
  equipment: string[]
  /**
   * True when this set is a deliberate statement rather than a profile guess.
   * Turns off the full-gym short-circuit and the strict-pool bypass in
   * filterCandidateEquipment — both of which exist to stop a GUESS from
   * over-filtering, and neither of which should override an answer.
   */
  strict: boolean
  /**
   * "unknown": there is no profile at all (no client, or the coach chose
   * "ignore profile"), so nothing says what is missing — every item the library
   * uses counts as available. NOT the same as a profile that lists nothing.
   */
  source: "override" | "instructions" | "profile" | "unknown"
}

/**
 * What equipment this generation may actually use, and how much we trust it.
 *
 * Precedence, strongest first:
 *
 * 1. `override` — the coach ticked boxes for this run. Replaces the profile and
 *    is NOT widened by equipment inferred from their prose, or unticking
 *    "dumbbell" while writing "hotel week" would hand the dumbbells back.
 * 2. `intentOnly` — a restriction read out of their instructions ("bodyweight
 *    only", "bands only"). Narrows the profile. Already vetoed by
 *    hasRestrictionCue upstream, so reaching here means the coach's own words
 *    contained a restriction.
 * 3. the profile, widened by equipment they named. The profile is a guess —
 *    empty whenever no profile exists — so naming equipment adds to it.
 *
 * 4. no profile at all (`profileEquipment: null`) — "unknown", so every item in
 *    `libraryEquipment` counts as available. Until 2026-10-01 a missing profile
 *    read as an empty one, i.e. "no equipment": every program built without a
 *    client was generated from the ~100 exercises that need nothing, and an
 *    Exercise Pool of kit exercises was filtered away before the AI saw it.
 *
 * Before 2026-09-21 only rule 3 existed, and the union could only ever GROW the
 * set. "Hotel, no equipment" therefore had no way to shrink it, which is how a
 * travelling client received a week of TRX, cable and dumbbell work.
 */
export function resolveEffectiveEquipment(opts: {
  override?: string[] | null
  /** null = there is no profile (no client, or "ignore profile"); [] = a profile listing nothing. */
  profileEquipment: string[] | null
  /** Every equipment item the exercise library uses — what "unknown" makes available. */
  libraryEquipment?: string[]
  intentRequired: string[]
  intentOnly: string[] | null
}): EffectiveEquipment {
  if (Array.isArray(opts.override)) {
    return { equipment: [...new Set(opts.override)], strict: true, source: "override" }
  }
  if (opts.intentOnly !== null) {
    return { equipment: [...new Set(opts.intentOnly)], strict: true, source: "instructions" }
  }
  if (opts.profileEquipment === null) {
    return {
      equipment: [...new Set([...(opts.libraryEquipment ?? []), ...opts.intentRequired])],
      strict: false,
      source: "unknown",
    }
  }
  return {
    equipment: [...new Set([...opts.profileEquipment, ...opts.intentRequired])],
    strict: false,
    source: "profile",
  }
}

/** Every equipment item the library uses — the "unknown" set for resolveEffectiveEquipment. */
export function libraryEquipmentOf(exercises: Array<{ equipment_required?: string[] | null }>): string[] {
  return [...new Set(exercises.flatMap((e) => e.equipment_required ?? []))].sort()
}

// ─── Equipment violations (coach-facing) ────────────────────────────────────

import { normalizeEquipment } from "./validate.js"

export interface EquipmentViolation {
  slot_id: string
  exercise_name: string
  /** The required items that are NOT available — not the exercise's whole list. */
  missing: string[]
}

/**
 * Exercises the selector chose that the client cannot actually perform.
 *
 * This is the last line of defence, and on the add-a-week path it is the ONLY
 * one: `validateProgram` is imported by week-orchestrator.ts but never called,
 * so nothing else compares the finished week against the equipment it assumes.
 * A "hotel, no equipment" week shipped with TRX glides and a cable-machine
 * stretch in it on 2026-09-21 without a single warning (see
 * filterByAvailableEquipment for why the candidate pool let them through).
 *
 * Reports rather than blocks: a coach who deliberately unlocked an exercise by
 * name, or who is one dumbbell short, wants to see the list and decide — not
 * lose the whole generation and its credits to a refusal.
 */
export function findEquipmentViolations(
  assignments: Array<{ slot_id: string; exercise_id: string; exercise_name: string }>,
  exercises: CompressedExercise[],
  availableEquipment: string[],
): EquipmentViolation[] {
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const available = new Set(availableEquipment.map(normalizeEquipment))
  const violations: EquipmentViolation[] = []

  for (const assigned of assignments) {
    const exercise = byId.get(assigned.exercise_id)
    // An id the library does not contain is a different fault (a hallucinated
    // or retired exercise) and is already reported by the resolver.
    if (!exercise) continue
    const missing = (exercise.equipment_required ?? []).filter((eq) => !available.has(normalizeEquipment(eq)))
    if (missing.length > 0) {
      violations.push({ slot_id: assigned.slot_id, exercise_name: exercise.name, missing })
    }
  }

  return violations
}

/**
 * Turn violations into one coach-facing line, written for someone reading it in
 * a hurry between sessions: how many, which equipment, and one exercise name
 * they can actually search for in the week.
 */
export function buildEquipmentWarnings(
  violations: EquipmentViolation[],
  availableEquipment: string[],
  source: EffectiveEquipment["source"] = "override",
): string[] {
  if (violations.length === 0) return []

  const equipment = [...new Set(violations.flatMap((v) => v.missing))].sort()
  const list = [...new Set(availableEquipment.map(normalizeEquipment))].sort().join(", ")
  // Say where the list came from. "You set no equipment" on a run where the coach
  // set nothing (the empty list was the client's profile) sent him looking for a
  // setting he never touched.
  const had =
    source === "profile"
      ? availableEquipment.length > 0
        ? `The client's profile lists only: ${list}.`
        : "The client's profile lists no equipment."
      : source === "instructions"
        ? availableEquipment.length > 0
          ? `Your instructions allowed only: ${list}.`
          : "Your instructions allowed no equipment."
        : availableEquipment.length > 0
          ? `You set this week's equipment to: ${list}.`
          : "You set no equipment at all for this week."

  return [
    `${violations.length} exercise${violations.length === 1 ? "" : "s"} in this week need equipment that was not ` +
      `available — ${equipment.join(", ")}. For example "${violations[0].exercise_name}" (slot ${violations[0].slot_id}). ` +
      `${had} Swap these out, or re-generate with the equipment list corrected.`,
  ]
}
