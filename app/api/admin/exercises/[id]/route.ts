import { NextResponse } from "next/server"
import { exerciseFormSchema } from "@/lib/validators/exercise"
import { updateExercise, deleteExercise } from "@/lib/db/exercises"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const result = exerciseFormSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const exercise = await updateExercise(id, result.data)
    return NextResponse.json(exercise)
  } catch {
    return NextResponse.json({ error: "Failed to update exercise. Please try again." }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteExercise(id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to delete exercise. Please try again." }, { status: 500 })
  }
}
