import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAllFormReviews, getFormReviewCounts } from "@/lib/db/form-reviews"
import type { FormReviewStatus } from "@/types/database"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") as FormReviewStatus | null
    const includeCounts = searchParams.get("counts") === "true"

    const filters = status ? { status } : undefined
    const reviews = await getAllFormReviews(filters)

    if (includeCounts) {
      const counts = await getFormReviewCounts()
      return NextResponse.json({ reviews, counts })
    }

    return NextResponse.json(reviews)
  } catch (error) {
    console.error("Admin form reviews GET error:", error)
    return NextResponse.json({ error: "Failed to fetch form reviews" }, { status: 500 })
  }
}
