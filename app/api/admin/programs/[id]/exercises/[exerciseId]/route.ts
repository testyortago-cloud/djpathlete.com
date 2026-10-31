import { NextResponse } from "next/server"
import { programExerciseUpdateSchema } from "@/lib/validators/program-exercise"
import { updateProgramExercise, removeExerciseFromProgram } from "@/lib/db/program-exercises"
import { logBuilderExerciseEdit } from "@/lib/program-exercise-edit-log"

type Params = { params: Promise<{ id: string; exerciseId: string }> }

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { exerciseId } = await params
    const body = await request.json()
    const result = programExerciseUpdateSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // Only include fields that were actually sent in the request body.
    // The Zod schema transforms convert missing optional fields to null,
    // which would wipe existing data (e.g. sets, reps) on a drag-move
    // that only sends day_of_week + order_index.
    const updates: Record<string, unknown> = {}
    for (const key of Object.keys(result.data)) {
      if (key in body) {
        updates[key] = (result.data as Record<string, unknown>)[key]
      }
    }

    const updated = await updateProgramExercise(exerciseId, updates)
    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: "Failed to update exercise. Please try again." }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { exerciseId } = await params
    const removed = await removeExerciseFromProgram(exerciseId)
    if (removed) {
      await logBuilderExerciseEdit(request, {
        programId: removed.program_id,
        exerciseId: removed.exercise_id,
        action: "removed",
        aiPick: removed.slot_role !== null,
        weekNumber: removed.week_number,
        dayOfWeek: removed.day_of_week,
      })
    }
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to remove exercise. Please try again." }, { status: 500 })
  }
}
