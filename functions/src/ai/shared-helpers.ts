import { getSupabase } from "../lib/supabase.js"

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
  return `\n\n## COACH INSTRUCTIONS (HIGHEST PRIORITY — these override ALL default rules)\n${instructions}\n\nYou MUST follow these instructions exactly. They override ALL default rules including:
- **Structure**: If the coach specifies exercise counts (e.g., "4 power exercises", "2 quad exercises", "3 compounds and 2 accessories"), create exactly that many slots with the matching roles/patterns. Do NOT add extra slots or ignore the counts.
- **Periodization**: If the coach requests deload weeks, specific phases, or intensity patterns (e.g., "deload on week 4", "first 2 weeks hypertrophy then strength"), structure the program exactly as described.
- **Technique**: If the coach names a set technique (e.g., "no supersets", "use circuits", "use cluster sets", "rest-pause on compounds", "wave loading"), apply EXACTLY that technique even if default rules would suggest otherwise. Do not silently substitute supersets or straight sets because they are more familiar — if the coach asked for cluster sets, the program uses cluster sets.
- **Exercise focus**: If the coach requests specific focus areas, muscle groups, or movement patterns, prioritize those in slot design and exercise selection.
- **Session design**: If the coach specifies session structure (e.g., "start with plyometrics", "finish with core"), follow that order.

The coach is the authority. Their instructions reflect knowledge of the athlete that may not be in the profile. When in doubt, follow the coach's intent over any algorithmic default.`
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
): string {
  if (!poolIds || poolIds.length === 0) return ""
  if (mode === "strict") {
    return `\n\nNOTE: The exercise library has been pre-filtered to a coach-curated Exercise Pool of ${filteredCount} exercises. You MUST select from these exercises ONLY. If a slot cannot be perfectly matched, pick the closest available exercise from the pool. Do NOT reference exercises outside this list.`
  }
  // Preferred (guideline) mode
  const total = poolCount ?? poolIds.length
  return `\n\nNOTE: The coach has curated an Exercise Pool of ${total} preferred exercises. These are STRONGLY PREFERRED — fill every slot from this pool when a pool exercise reasonably matches the slot's movement_pattern, target_muscles, and role. You MAY pick an exercise from outside the pool ONLY when no pool exercise is a sensible fit for the slot — in that case, add a substitution_note explaining why no pool option fit. AIM to use as many DIFFERENT pool exercises as possible across the week — do not duplicate pool exercises while ignoring others that fit.`
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
 */
export function filterCandidateEquipment(
  exercises: CompressedExercise[],
  availableEquipment: string[],
  poolActive: boolean,
): CompressedExercise[] {
  if (poolActive) return exercises
  return filterByAvailableEquipment(exercises, availableEquipment)
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

export function sanitizeSlotRefsInNotes(
  notes: string | null,
  nameBySlotId: Map<string, string>,
): string | null {
  if (!notes) return notes
  const cleaned = notes
    .replace(SLOT_REF_RE, (ref) => nameBySlotId.get(ref.toLowerCase()) ?? "the paired exercise")
    .replace(ID_FRAGMENT_RE, "")
  if (cleaned === notes) return notes
  // Stripping a fragment can leave doubled spaces or a leading/trailing gap.
  return cleaned.replace(/ {2,}/g, " ").trim()
}

export function buildExerciseRows(
  assignments: Array<{ slot_id: string; exercise_id: string; notes: string | null; exercise_name?: string }>,
  slotLookup: Map<string, SlotLocation>,
  slotDetailsLookup: Map<string, SlotDetails>,
  programId: string,
): Record<string, unknown>[] {
  const nameBySlotId = new Map<string, string>()
  for (const a of assignments) {
    if (a.exercise_name) nameBySlotId.set(a.slot_id.toLowerCase(), a.exercise_name)
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
        reps: details.reps,
        duration_seconds: null,
        rest_seconds: details.rest_seconds,
        notes: sanitizeSlotRefsInNotes(assigned.notes, nameBySlotId),
        rpe_target: details.rpe_target,
        intensity_pct: null,
        tempo: details.tempo,
        group_tag: details.group_tag,
        technique: VALID_TECHNIQUES.has(details.technique ?? "") ? details.technique : "straight_set",
        slot_role: details.role,
      }
    })
    .filter((r) => r !== null) as Record<string, unknown>[]
}
