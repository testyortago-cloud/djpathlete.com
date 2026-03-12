import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getPerformanceAssessmentById,
  getAssessmentExercises,
} from "@/lib/db/performance-assessments"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const assessment = await getPerformanceAssessmentById(id)

    if (assessment.client_user_id !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (assessment.status === "draft") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const exercises = await getAssessmentExercises(id)
    return NextResponse.json({ assessment, exercises })
  } catch (error) {
    console.error("Client performance assessment GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch assessment" },
      { status: 500 }
    )
  }
}
