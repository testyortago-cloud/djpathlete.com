import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import { getFormReviewById, getFormReviewMessages, createFormReviewMessage } from "@/lib/db/form-reviews"

const messageSchema = z.object({
  message: z.string().min(1).max(5000),
})

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
    const parsed = messageSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    const message = await createFormReviewMessage({
      form_review_id: id,
      user_id: session.user.id,
      message: parsed.data.message,
    })

    return NextResponse.json(message, { status: 201 })
  } catch (error) {
    console.error("Form review message POST error:", error)
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 })
  }
}
