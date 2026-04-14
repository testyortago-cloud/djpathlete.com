import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getFormReviewById } from "@/lib/db/form-reviews"
import { getSignedVideoUrl } from "@/lib/firebase-admin"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const review = await getFormReviewById(id)

    // Verify the client owns this review
    if (review.client_user_id !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

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
    console.error("Client form review GET error:", error)
    return NextResponse.json({ error: "Failed to fetch form review" }, { status: 500 })
  }
}
