import { NextResponse } from "next/server"
import { programExerciseSchema } from "@/lib/validators/program-exercise"
import { addExerciseToProgram } from "@/lib/db/program-exercises"
import { logBuilderExerciseEdit } from "@/lib/program-exercise-edit-log"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const result = programExerciseSchema.safeParse(body)

    if (!result.success) {
      console.error("[API program exercises POST] Validation failed:", result.error.flatten().fieldErrors)
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const programExercise = await addExerciseToProgram({
      program_id: id,
      ...result.data,
    })

    await logBuilderExerciseEdit(request, {
      programId: id,
      exerciseId: programExercise.exercise_id,
      action: "added",
      aiPick: false,
      weekNumber: programExercise.week_number,
      dayOfWeek: programExercise.day_of_week,
    })

    return NextResponse.json(programExercise, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to add exercise to program. Please try again." }, { status: 500 })
  }
}
