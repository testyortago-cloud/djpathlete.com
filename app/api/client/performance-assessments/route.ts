import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getPerformanceAssessmentsByClient } from "@/lib/db/performance-assessments"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const assessments = await getPerformanceAssessmentsByClient(session.user.id)
    return NextResponse.json(assessments)
  } catch (error) {
    console.error("Client performance assessments GET error:", error)
    return NextResponse.json({ error: "Failed to fetch assessments" }, { status: 500 })
  }
}
