import { createServiceRoleClient } from "@/lib/supabase"
import type { ExerciseFavoriteSource, ExerciseFavoriteWithExercise } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

const EXERCISE_COLS = "id,name,category,muscle_group,video_url,thumbnail_url,difficulty"

export async function getFavoriteExerciseIds(clientUserId: string): Promise<Set<string>> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_favorites")
    .select("exercise_id")
    .eq("client_user_id", clientUserId)
  if (error) throw error
  return new Set((data ?? []).map((r: { exercise_id: string }) => r.exercise_id))
}

export async function listFavoritesByClient(clientUserId: string): Promise<ExerciseFavoriteWithExercise[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_favorites")
    .select(`*, exercise:exercises(${EXERCISE_COLS})`)
    .eq("client_user_id", clientUserId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as ExerciseFavoriteWithExercise[]
}

export async function addFavorite(
  clientUserId: string,
  exerciseId: string,
  opts: { createdBy: string; source: ExerciseFavoriteSource },
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("exercise_favorites")
    .upsert(
      {
        client_user_id: clientUserId,
        exercise_id: exerciseId,
        created_by: opts.createdBy,
        source: opts.source,
      },
      { onConflict: "client_user_id,exercise_id", ignoreDuplicates: true },
    )
  if (error) throw error
}

export async function removeFavorite(clientUserId: string, exerciseId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("exercise_favorites")
    .delete()
    .eq("client_user_id", clientUserId)
    .eq("exercise_id", exerciseId)
  if (error) throw error
}
