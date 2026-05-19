import { createServiceRoleClient } from "@/lib/supabase"
import { getSignedVideoUrl } from "@/lib/firebase-admin"
import type { FormReview, FormReviewMessage, FormReviewMessageAttachment, FormReviewStatus } from "@/types/database"

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
    .select("*, users(first_name, last_name, avatar_url, role), form_review_message_attachments(*)")
    .eq("form_review_id", reviewId)
    .order("created_at", { ascending: true })
  if (error) throw error

  const rows = (data ?? []) as Array<
    FormReviewMessage & {
      form_review_message_attachments?: FormReviewMessageAttachment[]
      users?: {
        first_name: string
        last_name: string
        avatar_url?: string | null
        role?: string
      } | null
    }
  >

  // Sign audio attachment URLs server-side; client never sees raw Firebase paths.
  return Promise.all(
    rows.map(async (row) => {
      const rawAttachments = row.form_review_message_attachments ?? []
      const attachments = await Promise.all(
        rawAttachments.map(async (att) => {
          if (att.kind !== "audio") return att
          let playback_url: string | null = null
          try {
            playback_url = await getSignedVideoUrl(att.storage_path)
          } catch (err) {
            console.error("Failed to sign audio attachment URL:", att.storage_path, err)
          }
          return { ...att, playback_url }
        }),
      )
      const { form_review_message_attachments: _, ...rest } = row
      return { ...rest, attachments }
    }),
  )
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

export async function createFormReviewMessageWithAudio(input: {
  review_id: string
  user_id: string
  kind: "audio"
  storage_path: string
  mime_type: string
  duration_seconds: number
  byte_size: number
}): Promise<FormReviewMessage> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("create_form_review_message_with_attachment", {
    p_review_id: input.review_id,
    p_user_id: input.user_id,
    p_kind: input.kind,
    p_storage_path: input.storage_path,
    p_mime_type: input.mime_type,
    p_duration_seconds: input.duration_seconds,
    p_byte_size: input.byte_size,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error("RPC returned no row")

  return {
    id: row.message_id,
    form_review_id: input.review_id,
    user_id: input.user_id,
    message: null,
    created_at: row.created_at,
    attachments: [
      {
        id: row.attachment_id,
        message_id: row.message_id,
        kind: "audio",
        storage_path: input.storage_path,
        mime_type: input.mime_type,
        duration_seconds: input.duration_seconds,
        byte_size: input.byte_size,
        created_at: row.created_at,
      },
    ],
  }
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

export async function getDeliveredFormReviewStats(
  from: Date,
  to: Date,
): Promise<{ count: number; avgResponseHours: number }> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("form_reviews")
    .select("created_at, updated_at, status")
    .eq("status", "reviewed")
    .gte("updated_at", from.toISOString())
    .lt("updated_at", to.toISOString())
  if (error) throw error
  const rows = (data ?? []) as Array<{ created_at: string; updated_at: string }>
  if (rows.length === 0) return { count: 0, avgResponseHours: 0 }
  const totalHours = rows.reduce((sum, r) => {
    const dt = new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()
    return sum + dt / (3600 * 1000)
  }, 0)
  return { count: rows.length, avgResponseHours: Math.round(totalHours / rows.length) }
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
