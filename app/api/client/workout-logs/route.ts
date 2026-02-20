import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getProgress } from "@/lib/db/progress"

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
        { error: "exerciseId query parameter is required" },
        { status: 400 }
      )
    }

    const from = searchParams.get("from")
    const to = searchParams.get("to")
    const limit = parseInt(searchParams.get("limit") ?? "50", 10)

    // Fetch all progress for this user + exercise
    let records = await getProgress(session.user.id, exerciseId)

    // Apply optional date range filters
    if (from) {
      const fromDate = new Date(from)
      records = records.filter(
        (r) => new Date(r.completed_at) >= fromDate
      )
    }
    if (to) {
      const toDate = new Date(to)
      records = records.filter(
        (r) => new Date(r.completed_at) <= toDate
      )
    }

    // Apply limit
    if (limit > 0) {
      records = records.slice(0, limit)
    }

    return NextResponse.json(records)
  } catch (error) {
    console.error("Workout logs GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch workout logs" },
      { status: 500 }
    )
  }
}
