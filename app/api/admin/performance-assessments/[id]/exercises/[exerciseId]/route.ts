import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import {
  updateAssessmentExercise,
  deleteAssessmentExercise,
} from "@/lib/db/performance-assessments"

const updateSchema = z.object({
  video_path: z.string().nullable().optional(),
  admin_notes: z.string().max(2000).nullable().optional(),
  youtube_url: z.string().url().nullable().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { exerciseId } = await params
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
    console.error("Admin assessment exercise PATCH error:", error)
    return NextResponse.json(
      { error: "Failed to update exercise" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { exerciseId } = await params
    await deleteAssessmentExercise(exerciseId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Admin assessment exercise DELETE error:", error)
    return NextResponse.json(
      { error: "Failed to delete exercise" },
      { status: 500 }
    )
  }
}
