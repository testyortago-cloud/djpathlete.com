import { getSupabase } from "../lib/supabase.js"

// What the generator learns from the coach's own changes to AI programs (program_exercise_edits, migration
// 00296). The owner, 2026-10-31: log how often Darren changes an exercise, and have the generator learn from it.
//
// Soft, like favourites: a score term, never a filter. Injury, equipment, difficulty and Blocked still decide
// what is allowed; the coach's Blocked list is the hard "never".

/** TWIN of EDIT_LEARNING_DAYS in lib/db/program-exercise-edits.ts: the settings card counts the same window. */
export const EDIT_LEARNING_DAYS = 180

/** Per time the coach took out an exercise the AI had placed. */
export const REMOVED_PENALTY = 15
export const MAX_REMOVED_PENALTY = 45
/** Per time the coach put an exercise into an AI program. */
export const ADDED_BOOST = 10
export const MAX_ADDED_BOOST = 30

export interface EditRow {
  exercise_id: string
  action: "removed" | "added"
  ai_pick: boolean
}

/** Score adjustment per exercise. Removing one the coach had added themselves teaches nothing about the AI. */
export function editScoresFrom(rows: readonly EditRow[]): Map<string, number> {
  const removed = new Map<string, number>()
  const added = new Map<string, number>()
  for (const r of rows) {
    if (r.action === "removed" && r.ai_pick) removed.set(r.exercise_id, (removed.get(r.exercise_id) ?? 0) + 1)
    if (r.action === "added") added.set(r.exercise_id, (added.get(r.exercise_id) ?? 0) + 1)
  }
  const scores = new Map<string, number>()
  for (const id of new Set([...removed.keys(), ...added.keys()])) {
    const score =
      Math.min((added.get(id) ?? 0) * ADDED_BOOST, MAX_ADDED_BOOST) -
      Math.min((removed.get(id) ?? 0) * REMOVED_PENALTY, MAX_REMOVED_PENALTY)
    if (score !== 0) scores.set(id, score)
  }
  return scores
}

/**
 * The requesting coach's adjustments over the learning window. Empty on failure: a missing lesson must never
 * fail a generation.
 */
export async function getCoachEditScoresFromFn(coachId: string, now = new Date()): Promise<Map<string, number>> {
  const since = new Date(now.getTime() - EDIT_LEARNING_DAYS * 86_400_000).toISOString()
  const { data, error } = await getSupabase()
    .from("program_exercise_edits")
    .select("exercise_id, action, ai_pick")
    .eq("coach_id", coachId)
    .gte("created_at", since)
    // ponytail: the newest 1000 changes only (PostgREST's row cap). Page through if one coach ever passes it.
    .order("created_at", { ascending: false })
    .limit(1000)
  if (error) {
    console.warn("[edit-learning] read failed:", error.message)
    return new Map()
  }
  return editScoresFrom((data ?? []) as EditRow[])
}
