import { createServiceRoleClient } from "@/lib/supabase"
import type { Review } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side admin routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getReviews(published?: boolean) {
  const supabase = getClient()
  let query = supabase
    .from("reviews")
    .select("*, users(first_name, last_name, avatar_url)")
    .order("created_at", { ascending: false })
  if (published !== undefined) {
    query = query.eq("is_published", published)
  }
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function createReview(
  review: Omit<Review, "id" | "created_at" | "updated_at">
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("reviews")
    .insert(review)
    .select()
    .single()
  if (error) throw error
  return data as Review
}

export async function updateReview(
  id: string,
  updates: Partial<Omit<Review, "id" | "created_at">>
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("reviews")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Review
}

export async function deleteReview(id: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("reviews")
    .delete()
    .eq("id", id)
  if (error) throw error
}
