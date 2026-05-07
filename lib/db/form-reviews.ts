import { createServiceRoleClient } from "@/lib/supabase"
import type { FormReview, FormReviewMessage, FormReviewStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

// ---------------------------------------------------------------------------
// Form Reviews
// ---------------------------------------------------------------------------

export async function getFormReviewsByClient(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("form_reviews")
    .select("*")
    .eq("client_user_id", userId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return data
}

export async function getAllFormReviews(filters?: { status?: FormReviewStatus }) {
  const supabase = getClient()
  let query = supabase
    .from("form_reviews")
    .select("*, users(first_name, last_name, email)")
    .order("created_at", { ascending: false })

  if (filters?.status) {
    query = query.eq("status", filters.status)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getFormReviewById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("form_reviews")
    .select("*, users(first_name, last_name, email, avatar_url)")
    .eq("id", id)
    .single()
  if (error) throw error
  return data
}

export async function createFormReview(review: Omit<FormReview, "id" | "created_at" | "updated_at" | "thumbnail_url">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("form_reviews").insert(review).select().single()
  if (error) throw error
  return data as FormReview
}

export async function updateFormReview(
  id: string,
  updates: Partial<Pick<FormReview, "status" | "video_path" | "thumbnail_url">>,
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("form_reviews").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as FormReview
}

// ---------------------------------------------------------------------------
// Form Review Messages
// ---------------------------------------------------------------------------

export async function getFormReviewMessages(reviewId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("form_review_messages")
    .select("*, users(first_name, last_name, avatar_url, role)")
    .eq("form_review_id", reviewId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return data
}

export async function createFormReviewMessage(message: Omit<FormReviewMessage, "id" | "created_at">) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("form_review_messages")
    .insert(message)
    .select("*, users(first_name, last_name, avatar_url, role)")
    .single()
  if (error) throw error
  return data
}

export async function listFormReviewsByStatus(status: FormReviewStatus) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("form_reviews")
    .select("id, created_at, status")
    .eq("status", status)
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data ?? []) as Array<{ id: string; created_at: string; status: FormReviewStatus }>
}

// ---------------------------------------------------------------------------
// Counts (for admin badge)
// ---------------------------------------------------------------------------

export async function getFormReviewCounts() {
  const supabase = getClient()
  const { data, error } = await supabase.from("form_reviews").select("status")
  if (error) throw error

  const counts = { pending: 0, in_progress: 0, reviewed: 0, total: 0 }
  for (const row of data ?? []) {
    counts[row.status as FormReviewStatus]++
    counts.total++
  }
  return counts
}
