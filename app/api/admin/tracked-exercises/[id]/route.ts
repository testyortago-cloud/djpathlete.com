import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { deleteTrackedExercise } from "@/lib/db/tracked-exercises"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    await deleteTrackedExercise(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Admin tracked exercise DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete tracked exercise" }, { status: 500 })
  }
}
