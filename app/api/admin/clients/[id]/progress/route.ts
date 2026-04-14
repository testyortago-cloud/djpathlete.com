import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getProgress, getProgressByAssignment } from "@/lib/db/progress"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const { id: userId } = await params
    const { searchParams } = new URL(request.url)
    const assignmentId = searchParams.get("assignment_id")

    const data = assignmentId ? await getProgressByAssignment(userId, assignmentId) : await getProgress(userId)

    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch progress"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
