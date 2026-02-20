import { createServiceRoleClient } from "@/lib/supabase"
import type { Achievement, AchievementType } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getAchievements(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("achievements")
    .select("*")
    .eq("user_id", userId)
    .order("earned_at", { ascending: false })
  if (error) throw error
  return data as Achievement[]
}

export async function getAchievementsByType(
  userId: string,
  type: AchievementType
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("achievements")
    .select("*")
    .eq("user_id", userId)
    .eq("achievement_type", type)
    .order("earned_at", { ascending: false })
  if (error) throw error
  return data as Achievement[]
}

export async function getUncelebratedAchievements(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("achievements")
    .select("*")
    .eq("user_id", userId)
    .eq("celebrated", false)
    .order("earned_at", { ascending: false })
  if (error) throw error
  return data as Achievement[]
}

export async function createAchievement(
  data: Omit<Achievement, "id" | "created_at">
) {
  const supabase = getClient()
  const { data: result, error } = await supabase
    .from("achievements")
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return result as Achievement
}

export async function markCelebrated(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("achievements")
    .update({ celebrated: true })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Achievement
}

export async function getExercisePRs(userId: string, exerciseId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("achievements")
    .select("*")
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId)
    .eq("achievement_type", "pr")
    .order("earned_at", { ascending: false })
  if (error) throw error
  return data as Achievement[]
}
