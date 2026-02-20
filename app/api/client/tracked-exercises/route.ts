import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getTrackedExercisesForUser } from "@/lib/db/tracked-exercises"

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
    return NextResponse.json(
      { error: "Failed to fetch tracked exercises" },
      { status: 500 }
    )
  }
}
