import { getSupabase } from "./supabase.js"

/**
 * Twin of `getBlockedExerciseIds` in lib/db/exercise-blocks.ts. `functions/`
 * has rootDir "src" and cannot import from lib/, so this is a deliberate copy —
 * keep the two in step.
 *
 * Returns an EMPTY SET on failure. A blocklist outage must degrade to the
 * pre-blocklist behaviour, never fail a generation.
 */
export async function getBlockedExerciseIdsFromFn(
  coachId: string,
  clientId: string | null,
): Promise<Set<string>> {
  const supabase = getSupabase()
  let query = supabase.from("exercise_blocks").select("exercise_id").eq("coach_id", coachId)
  query = clientId ? query.or(`client_id.is.null,client_id.eq.${clientId}`) : query.is("client_id", null)
  const { data, error } = await query
  if (error) {
    console.warn("[exercise-blocks] getBlockedExerciseIdsFromFn failed:", error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r: { exercise_id: string }) => r.exercise_id))
}
