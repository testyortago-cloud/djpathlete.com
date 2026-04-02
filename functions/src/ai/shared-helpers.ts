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
      if (attempt === retries) throw new Error(`Failed to add exercises (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${error.message}`)
      console.warn(`[shared] bulkAddExercises batch ${Math.floor(i / BATCH_SIZE) + 1} attempt ${attempt} failed: ${error.message}, retrying...`)
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
}

// ─── Injury Joint Extraction ───────────────────────────────────────────────

const JOINT_KEYWORDS: Record<string, string> = {
  knee: "knee", ankle: "ankle", hip: "hip", shoulder: "shoulder",
  elbow: "elbow", wrist: "wrist", lower_back: "lumbar_spine",
  "lower back": "lumbar_spine", lumbar: "lumbar_spine",
  back: "thoracic_spine", thoracic: "thoracic_spine", spine: "lumbar_spine",
}

export function extractInjuredJoints(
  injuryDetails: Array<{ area?: string }> | null | undefined
): string[] {
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
  return `\n\n## COACH INSTRUCTIONS (HIGHEST PRIORITY — these override ALL default rules)\n${instructions}\n\nYou MUST follow these instructions. If they conflict with default technique, exercise, or structure rules, the coach's instructions WIN. For example, if the coach says "no supersets", use straight sets even if the default rules would suggest supersets for time efficiency.`
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
  logPrefix: string
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
        })
      })
    }
  }

  return { slotLookup, slotDetailsLookup }
}

export function buildExerciseRows(
  assignments: Array<{ slot_id: string; exercise_id: string; notes: string | null }>,
  slotLookup: Map<string, SlotLocation>,
  slotDetailsLookup: Map<string, SlotDetails>,
  programId: string
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
        technique: details.technique ?? "straight_set",
      }
    })
    .filter((r) => r !== null) as Record<string, unknown>[]
}
