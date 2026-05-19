import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getFormReviewById,
  getFormReviewMessages,
  createFormReviewMessage,
  createFormReviewMessageWithAudio,
  updateFormReview,
} from "@/lib/db/form-reviews"
import { createNotification } from "@/lib/db/notifications"
import { getUserById } from "@/lib/db/users"
import { sendFormReviewFeedbackEmail } from "@/lib/email"
import { formReviewMessageSchema } from "@/lib/validators/form-review-message"
import { recordAudit } from "@/lib/audit/record"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const { id } = await params
    const messages = await getFormReviewMessages(id)
    return NextResponse.json(messages)
  } catch (error) {
    console.error("Admin form review messages GET error:", error)
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = formReviewMessageSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    let message
    if ("audio" in parsed.data) {
      const a = parsed.data.audio
      const expectedPrefix = `form-review-audio/${session.user.id}/`
      if (!a.storage_path.startsWith(expectedPrefix)) {
        return NextResponse.json({ error: "Path ownership mismatch" }, { status: 403 })
      }
      message = await createFormReviewMessageWithAudio({
        review_id: id,
        user_id: session.user.id,
        kind: "audio",
        storage_path: a.storage_path,
        mime_type: a.mime_type,
        duration_seconds: a.duration_seconds,
        byte_size: a.byte_size,
      })
      // Fire-and-forget audit log
      recordAudit({
        action: "form_review.message.audio_sent",
        category: "client_action",
        target: { type: "form_review", id },
        metadata: { duration_seconds: a.duration_seconds, byte_size: a.byte_size },
      }).catch(() => {})
    } else {
      message = await createFormReviewMessage({
        form_review_id: id,
        user_id: session.user.id,
        message: parsed.data.message,
      })
    }

    const review = await getFormReviewById(id)
    if (review.status === "pending") {
      await updateFormReview(id, { status: "in_progress" })
    }

    try {
      const client = await getUserById(review.client_user_id)
      await createNotification({
        user_id: review.client_user_id,
        title: "Form Review Feedback",
        message: `Your coach left feedback on "${review.title}"`,
        type: "success",
        is_read: false,
        link: `/client/form-reviews/${review.id}`,
      })

      sendFormReviewFeedbackEmail({
        clientEmail: client.email,
        clientFirstName: client.first_name,
        clientUserId: client.id,
        reviewTitle: review.title,
        reviewId: review.id,
        audioDurationSeconds: "audio" in parsed.data ? parsed.data.audio.duration_seconds : null,
      }).catch((err) => console.error("Failed to send form review feedback email:", err))
    } catch (err) {
      console.error("Failed to notify client of form review feedback:", err)
    }

    return NextResponse.json(message, { status: 201 })
  } catch (error) {
    console.error("Admin form review message POST error:", error)
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 })
  }
}
