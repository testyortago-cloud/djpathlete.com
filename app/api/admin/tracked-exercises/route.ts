import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getTrackedExercises,
  createTrackedExercise,
} from "@/lib/db/tracked-exercises"
import { createTrackedExerciseSchema } from "@/lib/validators/tracked-exercise"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const assignmentId = searchParams.get("assignmentId")

    if (assignmentId) {
      const tracked = await getTrackedExercises(assignmentId)
      return NextResponse.json(tracked)
    }

    // Without assignmentId, return all tracked exercises (admin view)
    // Use a broad query — getTrackedExercisesForUser is client-scoped,
    // so for admin we fetch by assignment or return empty guidance
    return NextResponse.json(
      { error: "assignmentId query parameter is required for listing" },
      { status: 400 }
    )
  } catch (error) {
    console.error("Admin tracked exercises GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch tracked exercises" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = createTrackedExerciseSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const tracked = await createTrackedExercise({
      assignment_id: parsed.data.assignment_id,
      exercise_id: parsed.data.exercise_id,
      target_metric: parsed.data.target_metric,
      notes: parsed.data.notes,
      created_by: session.user.id,
    })

    return NextResponse.json(tracked, { status: 201 })
  } catch (error) {
    console.error("Admin tracked exercises POST error:", error)
    return NextResponse.json(
      { error: "Failed to create tracked exercise" },
      { status: 500 }
    )
  }
}
