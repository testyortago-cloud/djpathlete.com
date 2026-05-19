import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getFormReviewById,
  getFormReviewMessages,
  createFormReviewMessage,
  createFormReviewMessageWithAudio,
} from "@/lib/db/form-reviews"
import { formReviewMessageSchema } from "@/lib/validators/form-review-message"
import { recordAudit } from "@/lib/audit/record"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params

    // Verify the client owns this review
    const review = await getFormReviewById(id)
    if (review.client_user_id !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const messages = await getFormReviewMessages(id)
    return NextResponse.json(messages)
  } catch (error) {
    console.error("Form review messages GET error:", error)
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params

    // Verify the client owns this review
    const review = await getFormReviewById(id)
    if (review.client_user_id !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

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

    return NextResponse.json(message, { status: 201 })
  } catch (error) {
    console.error("Form review message POST error:", error)
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 })
  }
}
