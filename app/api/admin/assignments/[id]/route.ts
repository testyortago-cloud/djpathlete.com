import { NextResponse } from "next/server"
import { getAssignmentById, updateAssignment } from "@/lib/db/assignments"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { status } = body

    if (!status || !["active", "paused", "cancelled"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status. Must be one of: active, paused, cancelled" },
        { status: 400 }
      )
    }

    // Verify assignment exists
    const existing = await getAssignmentById(id)
    if (!existing) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
    }

    const updated = await updateAssignment(id, {
      status,
      ...(status === "cancelled" ? { end_date: new Date().toISOString().slice(0, 10) } : {}),
    })

    return NextResponse.json(updated)
  } catch {
    return NextResponse.json(
      { error: "Failed to update assignment. Please try again." },
      { status: 500 }
    )
  }
}
