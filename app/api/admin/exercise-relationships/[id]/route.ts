import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { deleteRelationship } from "@/lib/db/exercise-relationships"

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    await deleteRelationship(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Exercise relationship DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete relationship" }, { status: 500 })
  }
}
