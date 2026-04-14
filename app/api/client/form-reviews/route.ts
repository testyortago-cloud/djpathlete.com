import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import { getFormReviewsByClient, createFormReview } from "@/lib/db/form-reviews"
import { createNotification } from "@/lib/db/notifications"
import { getUsers } from "@/lib/db/users"
import { getUserById } from "@/lib/db/users"
import { sendFormReviewRequestEmail } from "@/lib/email"

const createSchema = z.object({
  video_path: z.string().min(1),
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
})

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const reviews = await getFormReviewsByClient(session.user.id)
    return NextResponse.json(reviews)
  } catch (error) {
    console.error("Form reviews GET error:", error)
    return NextResponse.json({ error: "Failed to fetch form reviews" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      console.error(
        "Form review validation failed:",
        JSON.stringify(parsed.error.flatten()),
        "body:",
        JSON.stringify(body),
      )
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    const review = await createFormReview({
      client_user_id: session.user.id,
      video_path: parsed.data.video_path,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      status: "pending",
    })

    // Notify admin(s) — non-blocking
    try {
      const users = await getUsers()
      const admins = users.filter((u) => u.role === "admin")
      const client = await getUserById(session.user.id)
      const clientName = `${client.first_name} ${client.last_name}`

      for (const admin of admins) {
        await createNotification({
          user_id: admin.id,
          title: "New Form Review Request",
          message: `${clientName} submitted a form review: "${review.title}"`,
          type: "info",
          is_read: false,
          link: `/admin/form-reviews/${review.id}`,
        })

        // Send email notification — non-blocking
        sendFormReviewRequestEmail({
          coachEmail: admin.email,
          coachFirstName: admin.first_name,
          coachUserId: admin.id,
          clientName,
          reviewTitle: review.title,
          reviewId: review.id,
        }).catch((err) => console.error("Failed to send form review email:", err))
      }
    } catch (err) {
      console.error("Failed to notify admin of form review:", err)
    }

    return NextResponse.json(review, { status: 201 })
  } catch (error) {
    console.error("Form reviews POST error:", error)
    return NextResponse.json({ error: "Failed to create form review" }, { status: 500 })
  }
}
