import { createServiceRoleClient } from "@/lib/supabase"

export interface NormalizedGoogleReview {
  id: string
  user_id: string
  rating: number
  comment: string | null
  is_published: boolean
  created_at: string
  updated_at: string
  source: "google"
  google_maps_uri?: string
  users: {
    first_name: string
    last_name: string
    avatar_url: string | null
  }
}

/**
 * Fetch all imported Google reviews from the database
 * and normalize them into the same shape as in-app reviews.
 */
export async function fetchGoogleReviews(): Promise<NormalizedGoogleReview[]> {
  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from("google_reviews")
    .select("*")
    .order("review_date", { ascending: false })

  if (error) {
    console.error("[google-reviews] DB query failed:", error)
    return []
  }

  return (data ?? []).map((row): NormalizedGoogleReview => {
    const { firstName, lastName } = splitDisplayName(row.reviewer_name)

    return {
      id: `google_${row.id}`,
      user_id: `google_${row.id}`,
      rating: row.rating,
      comment: row.comment ?? null,
      is_published: true,
      created_at: row.review_date,
      updated_at: row.created_at,
      source: "google",
      users: {
        first_name: firstName,
        last_name: lastName,
        avatar_url: row.avatar_url ?? null,
      },
    }
  })
}

function splitDisplayName(displayName: string): {
  firstName: string
  lastName: string
} {
  const parts = displayName.trim().split(/\s+/)
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" }
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  }
}
