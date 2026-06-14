import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import {
  getFormReviewsByClient,
  createFormReview,
  getFormReviewContext,
} from "@/lib/db/form-reviews"
import { createNotification } from "@/lib/db/notifications"
import { getUsers } from "@/lib/db/users"
import { getUserById } from "@/lib/db/users"
import { sendFormReviewRequestEmail } from "@/lib/email"
import { withAudit } from "@/lib/audit/with-audit"
import { deriveFormReviewTitle } from "@/lib/workout/form-review"

const createSchema = z
  .object({
    video_path: z.string().min(1),
    title: z.string().min(1).max(200).optional(),
    notes: z.string().max(2000).nullable().optional(),
    // In-program context — present only for uploads made from a workout exercise.
    assignment_id: z.string().uuid().optional(),
    program_exercise_id: z.string().uuid().optional(),
    exercise_id: z.string().uuid().optional(),
    week_number: z.number().int().positive().optional(),
  })
  .refine((d) => !!d.title || (!!d.assignment_id && !!d.exercise_id), {
    message: "Either a title or program context (assignment_id + exercise_id) is required",
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

export const POST = withAudit(
  { action: "form_review.submitted", category: "support" },
  async (request) => {
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

      // Resolve + authorize in-program context (snapshot program/exercise names).
      let contextFields: {
        program_id?: string
        assignment_id?: string
        program_exercise_id?: string | null
        exercise_id?: string
        week_number?: number | null
        program_name?: string
        exercise_name?: string
      } = {}
      let title = parsed.data.title ?? ""

      if (parsed.data.assignment_id && parsed.data.exercise_id) {
        const ctx = await getFormReviewContext({
          assignmentId: parsed.data.assignment_id,
          exerciseId: parsed.data.exercise_id,
          userId: session.user.id,
        })
        if (!ctx) {
          return NextResponse.json({ error: "Assignment not found for this user" }, { status: 403 })
        }
        title = title || deriveFormReviewTitle(ctx.exercise_name, ctx.program_name, parsed.data.week_number)
        contextFields = {
          program_id: ctx.program_id,
          assignment_id: parsed.data.assignment_id,
          program_exercise_id: parsed.data.program_exercise_id ?? null,
          exercise_id: parsed.data.exercise_id,
          week_number: parsed.data.week_number ?? null,
          program_name: ctx.program_name,
          exercise_name: ctx.exercise_name,
        }
      }

      if (!title) {
        return NextResponse.json({ error: "A title is required" }, { status: 400 })
      }

      const review = await createFormReview({
        client_user_id: session.user.id,
        video_path: parsed.data.video_path,
        title,
        notes: parsed.data.notes ?? null,
        status: "pending",
        ...contextFields,
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
  },
)
