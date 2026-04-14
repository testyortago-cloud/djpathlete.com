import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import { getFormReviewById, updateFormReview } from "@/lib/db/form-reviews"
import { getSignedVideoUrl } from "@/lib/firebase-admin"

const updateSchema = z.object({
  status: z.enum(["pending", "in_progress", "reviewed"]),
})

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const review = await getFormReviewById(id)

    // Generate a signed URL for the video
    let videoUrl: string | null = null
    if (review.video_path) {
      try {
        videoUrl = await getSignedVideoUrl(review.video_path)
      } catch (err) {
        console.error("Failed to generate signed video URL:", err)
      }
    }

    return NextResponse.json({ ...review, videoUrl })
  } catch (error) {
    console.error("Admin form review GET error:", error)
    return NextResponse.json({ error: "Failed to fetch form review" }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    const updated = await updateFormReview(id, { status: parsed.data.status })
    return NextResponse.json(updated)
  } catch (error) {
    console.error("Admin form review PATCH error:", error)
    return NextResponse.json({ error: "Failed to update form review" }, { status: 500 })
  }
}
