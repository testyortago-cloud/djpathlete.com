import { NextResponse } from "next/server"
import { z } from "zod"
import { createServiceRoleClient } from "@/lib/supabase"

const googleReviewSchema = z.object({
  reviewer_name: z.string().min(1, "Reviewer name is required"),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable().optional(),
  review_date: z.string().min(1, "Review date is required"),
})

const bulkImportSchema = z.array(googleReviewSchema).min(1).max(100)

export async function POST(request: Request) {
  try {
    const body = await request.json()

    // Support both single review and array of reviews
    const reviews = Array.isArray(body) ? body : [body]

    const result = bulkImportSchema.safeParse(reviews)
    if (!result.success) {
      return NextResponse.json(
        {
          error: "Invalid review data",
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const supabase = createServiceRoleClient()

    const rows = result.data.map((r) => ({
      reviewer_name: r.reviewer_name,
      rating: r.rating,
      comment: r.comment ?? null,
      review_date: r.review_date,
    }))

    const { data, error } = await supabase
      .from("google_reviews")
      .insert(rows)
      .select()

    if (error) throw error

    return NextResponse.json(
      { imported: data?.length ?? 0 },
      { status: 201 }
    )
  } catch {
    return NextResponse.json(
      { error: "Failed to import reviews. Please try again." },
      { status: 500 }
    )
  }
}
