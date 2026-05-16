import { NextResponse } from "next/server"
import { updateReview, deleteReview } from "@/lib/db/reviews"
import { recordAudit } from "@/lib/audit/record"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    // Allow toggling is_published and updating comment/rating
    const allowedFields = ["is_published", "comment", "rating"] as const
    const updates: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field as string]
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 })
    }

    const review = await updateReview(id, updates)

    // Audit only on moderation decisions (is_published toggle).
    if ("is_published" in updates) {
      await recordAudit({
        action: "review.moderated",
        category: "marketing",
        target: { type: "review", id },
        metadata: { decision: updates.is_published ? "approved" : "rejected" },
        request,
      })
    }

    return NextResponse.json(review)
  } catch {
    return NextResponse.json({ error: "Failed to update review. Please try again." }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteReview(id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to delete review. Please try again." }, { status: 500 })
  }
}
