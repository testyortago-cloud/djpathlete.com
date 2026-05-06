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
- **Technique**: If the coach specifies techniques (e.g., "no supersets", "use circuits"), apply them even if default rules would suggest otherwise.
- **Exercise focus**: If the coach requests specific focus areas, muscle groups, or movement patterns, prioritize those in slot design and exercise selection.
- **Session design**: If the coach specifies session structure (e.g., "start with plyometrics", "finish with core"), follow that order.

The coach is the authority. Their instructions reflect knowledge of the athlete that may not be in the profile. When in doubt, follow the coach's intent over any algorithmic default.`
}

// ─── Exercise Pool Note ────────────────────────────────────────────────────

export function buildPoolNote(poolIds: string[] | undefined, filteredCount: number): string {
  if (!poolIds || poolIds.length === 0) return ""
  return `\n\nNOTE: The exercise library has been pre-filtered to a coach-curated Exercise Pool of ${filteredCount} exercises. You MUST select from these exercises ONLY. If a slot cannot be perfectly matched, pick the closest available exercise from the pool. Do NOT reference exercises outside this list.`
}

// ─── Pool Filtering ────────────────────────────────────────────────────────

export function applyPoolFilter<T extends { id: string }>(
  fullLibrary: T[],
  poolIds: string[] | undefined,
  logPrefix: string,
): T[] {
  if (!poolIds || poolIds.length === 0) return fullLibrary
  const poolSet = new Set(poolIds)
  const filtered = fullLibrary.filter((e) => poolSet.has(e.id))
  console.log(`[${logPrefix}] Exercise Pool active — using ${filtered.length}/${fullLibrary.length} exercises`)
  return filtered
}

// ─── Firebase Job Progress ─────────────────────────────────────────────────

export function createJobProgressUpdater(firebaseJobId: string | undefined, totalSteps: number) {
  return async function updateJobProgress(step: string, currentStep: number, detail?: string) {
    if (!firebaseJobId) return
    try {
      const { getDatabase } = await import("firebase-admin/database")
      const rtdb = getDatabase()
      await rtdb.ref(`ai_jobs/${firebaseJobId}`).update({
        progress: { status: step, current_step: currentStep, total_steps: totalSteps, detail: detail ?? null },
        updatedAt: Date.now(),
      })
    } catch (e) {
      console.warn(`[shared] Failed to update RTDB progress:`, e)
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

export function buildExerciseRows(
  assignments: Array<{ slot_id: string; exercise_id: string; notes: string | null }>,
  slotLookup: Map<string, SlotLocation>,
  slotDetailsLookup: Map<string, SlotDetails>,
  programId: string,
): Record<string, unknown>[] {
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
        notes: assigned.notes,
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
