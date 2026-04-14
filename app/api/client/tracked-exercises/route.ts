import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getTrackedExercisesForUser, createTrackedExercise, deleteTrackedExercise } from "@/lib/db/tracked-exercises"
import { getActiveAssignment } from "@/lib/db/assignments"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const tracked = await getTrackedExercisesForUser(session.user.id)

    return NextResponse.json(tracked)
  } catch (error) {
    console.error("Tracked exercises GET error:", error)
    return NextResponse.json({ error: "Failed to fetch tracked exercises" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { exerciseId } = await request.json()
    if (!exerciseId) {
      return NextResponse.json({ error: "exerciseId is required" }, { status: 400 })
    }

    // Get the user's active assignment
    const assignment = await getActiveAssignment(session.user.id)
    if (!assignment) {
      return NextResponse.json({ error: "No active program assignment found" }, { status: 400 })
    }

    const tracked = await createTrackedExercise({
      assignment_id: assignment.id,
      exercise_id: exerciseId,
      target_metric: "weight",
      created_by: session.user.id,
    })

    return NextResponse.json(tracked)
  } catch (error) {
    console.error("Tracked exercises POST error:", error)
    return NextResponse.json({ error: "Failed to track exercise" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    await deleteTrackedExercise(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Tracked exercises DELETE error:", error)
    return NextResponse.json({ error: "Failed to remove tracked exercise" }, { status: 500 })
  }
}
