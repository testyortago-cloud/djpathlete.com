import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import {
  getPerformanceAssessmentById,
  updateAssessmentExercise,
} from "@/lib/db/performance-assessments"

const updateSchema = z.object({
  video_path: z.string().nullable().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id, exerciseId } = await params

    // Verify ownership
    const assessment = await getPerformanceAssessmentById(id)
    if (assessment.client_user_id !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (assessment.status !== "in_progress") {
      return NextResponse.json(
        { error: "Assessment is not accepting uploads" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const updated = await updateAssessmentExercise(exerciseId, parsed.data)
    return NextResponse.json(updated)
  } catch (error) {
    console.error("Client assessment exercise PATCH error:", error)
    return NextResponse.json(
      { error: "Failed to update exercise" },
      { status: 500 }
    )
  }
}
