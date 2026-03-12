import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import {
  getPerformanceAssessmentById,
  getAssessmentExercises,
  updatePerformanceAssessment,
  addAssessmentExercise,
} from "@/lib/db/performance-assessments"
import { createNotification } from "@/lib/db/notifications"
import { getUserById } from "@/lib/db/users"
import { sendPerformanceAssessmentSharedEmail } from "@/lib/email"

const updateSchema = z.object({
  status: z.enum(["draft", "in_progress", "completed"]).optional(),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(5000).nullable().optional(),
})

const addExerciseSchema = z.object({
  exercise_id: z.string().uuid().nullable(),
  custom_name: z.string().max(200).nullable(),
  youtube_url: z.string().url().nullable().optional(),
  admin_notes: z.string().max(2000).nullable().optional(),
}).refine((d) => d.exercise_id || d.custom_name, {
  message: "Either exercise_id or custom_name is required",
})

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const [assessment, exercises] = await Promise.all([
      getPerformanceAssessmentById(id),
      getAssessmentExercises(id),
    ])

    return NextResponse.json({ assessment, exercises })
  } catch (error) {
    console.error("Admin performance assessment GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch assessment" },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const updated = await updatePerformanceAssessment(id, parsed.data)

    // If sharing with client (draft -> in_progress), notify them
    if (parsed.data.status === "in_progress") {
      try {
        const assessment = await getPerformanceAssessmentById(id)
        const client = await getUserById(assessment.client_user_id)
        await createNotification({
          user_id: assessment.client_user_id,
          title: "Performance Assessment",
          message: `Your coach shared a performance assessment: "${assessment.title}"`,
          type: "info",
          is_read: false,
          link: `/client/performance-assessments/${id}`,
        })

        sendPerformanceAssessmentSharedEmail({
          clientEmail: client.email,
          clientFirstName: client.first_name,
          clientUserId: client.id,
          assessmentTitle: assessment.title,
          assessmentId: id,
        }).catch((err) =>
          console.error("Failed to send assessment shared email:", err)
        )
      } catch (err) {
        console.error("Failed to notify client of assessment:", err)
      }
    }

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Admin performance assessment PATCH error:", error)
    return NextResponse.json(
      { error: "Failed to update assessment" },
      { status: 500 }
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = addExerciseSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    // Get current max order
    const exercises = await getAssessmentExercises(id)
    const maxOrder = exercises.length > 0
      ? Math.max(...exercises.map((e) => e.order_index))
      : -1

    const exercise = await addAssessmentExercise({
      assessment_id: id,
      exercise_id: parsed.data.exercise_id,
      custom_name: parsed.data.custom_name,
      youtube_url: parsed.data.youtube_url ?? null,
      video_path: null,
      admin_notes: parsed.data.admin_notes ?? null,
      order_index: maxOrder + 1,
    })

    return NextResponse.json(exercise, { status: 201 })
  } catch (error) {
    console.error("Admin add assessment exercise POST error:", error)
    return NextResponse.json(
      { error: "Failed to add exercise" },
      { status: 500 }
    )
  }
}
