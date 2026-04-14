import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import {
  getAllPerformanceAssessments,
  createPerformanceAssessment,
  createAssessmentExercises,
} from "@/lib/db/performance-assessments"
import { createNotification } from "@/lib/db/notifications"
import { getUserById } from "@/lib/db/users"
import { sendPerformanceAssessmentSharedEmail } from "@/lib/email"

const exerciseSchema = z
  .object({
    exercise_id: z.string().uuid().nullable(),
    custom_name: z.string().max(200).nullable(),
    youtube_url: z.string().url().nullable().optional(),
    admin_notes: z.string().max(2000).nullable().optional(),
    result_unit: z.string().max(50).nullable().optional(),
  })
  .refine((d) => d.exercise_id || d.custom_name, {
    message: "Either exercise_id or custom_name is required",
  })

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const createSchema = z.object({
  client_user_id: z.string().regex(uuidRegex, "Invalid UUID"),
  title: z.string().min(1).max(200),
  notes: z.string().max(5000).nullable().optional(),
  exercises: z.array(exerciseSchema).min(1, "At least one exercise is required"),
})

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const assessments = await getAllPerformanceAssessments()
    return NextResponse.json(assessments)
  } catch (error) {
    console.error("Admin performance assessments GET error:", error)
    return NextResponse.json({ error: "Failed to fetch assessments" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      console.error("[assessment-create] Validation error:", JSON.stringify(parsed.error.flatten(), null, 2))
      console.error("[assessment-create] Body:", JSON.stringify(body, null, 2))
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    const { client_user_id, title, notes, exercises } = parsed.data

    // Create the assessment
    const assessment = await createPerformanceAssessment({
      client_user_id,
      created_by: session.user.id,
      title,
      notes: notes ?? null,
      status: "draft",
    })

    // Create exercise rows
    await createAssessmentExercises(
      exercises.map((ex, i) => ({
        assessment_id: assessment.id,
        exercise_id: ex.exercise_id,
        custom_name: ex.custom_name,
        youtube_url: ex.youtube_url ?? null,
        video_path: null,
        admin_notes: ex.admin_notes ?? null,
        result_value: null,
        result_unit: ex.result_unit ?? null,
        order_index: i,
      })),
    )

    return NextResponse.json(assessment, { status: 201 })
  } catch (error) {
    console.error("Admin performance assessment POST error:", error)
    return NextResponse.json({ error: "Failed to create assessment" }, { status: 500 })
  }
}
