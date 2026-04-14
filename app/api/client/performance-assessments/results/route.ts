import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getExerciseResultHistory } from "@/lib/db/performance-assessments"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const exerciseId = searchParams.get("exercise_id")
    const customName = searchParams.get("custom_name")

    if (!exerciseId && !customName) {
      return NextResponse.json({ error: "exercise_id or custom_name is required" }, { status: 400 })
    }

    const history = await getExerciseResultHistory(session.user.id, {
      exercise_id: exerciseId || undefined,
      custom_name: customName || undefined,
    })

    return NextResponse.json(history)
  } catch (error) {
    console.error("Client assessment results GET error:", error)
    return NextResponse.json({ error: "Failed to fetch results" }, { status: 500 })
  }
}
