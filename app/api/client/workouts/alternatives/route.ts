import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getExerciseById, getAlternativeExercises } from "@/lib/db/exercises"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const exerciseId = searchParams.get("exerciseId")

    if (!exerciseId) {
      return NextResponse.json(
        { error: "exerciseId is required" },
        { status: 400 }
      )
    }

    const exercise = await getExerciseById(exerciseId)
    const { linked, similar } = await getAlternativeExercises(exerciseId, {
      category: exercise.category,
      muscle_group: exercise.muscle_group,
      movement_pattern: exercise.movement_pattern,
      primary_muscles: exercise.primary_muscles,
    })

    return NextResponse.json({ linked, similar })
  } catch (error) {
    console.error("[Alternatives] Error:", error)
    return NextResponse.json(
      { error: "Failed to fetch alternatives" },
      { status: 500 }
    )
  }
}
