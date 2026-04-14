import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { deleteDayExercises } from "@/lib/db/program-exercises"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const { id } = await params
    const { weekNumber, dayOfWeek } = (await request.json()) as {
      weekNumber: number
      dayOfWeek: number
    }

    if (!weekNumber || !dayOfWeek || dayOfWeek < 1 || dayOfWeek > 7) {
      return NextResponse.json({ error: "Invalid week number or day of week." }, { status: 400 })
    }

    await deleteDayExercises(id, weekNumber, dayOfWeek)

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to clear day. Please try again." }, { status: 500 })
  }
}
