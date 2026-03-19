import { NextResponse } from "next/server"
import { getAssignmentById, updateAssignment, deleteAssignment } from "@/lib/db/assignments"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { status, start_date, notes } = body

    // Must provide at least one field to update
    if (!status && start_date === undefined && notes === undefined) {
      return NextResponse.json(
        { error: "No update fields provided" },
        { status: 400 }
      )
    }

    if (status && !["active", "paused", "cancelled"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status. Must be one of: active, paused, cancelled" },
        { status: 400 }
      )
    }

    if (start_date !== undefined && (typeof start_date !== "string" || !DATE_RE.test(start_date))) {
      return NextResponse.json(
        { error: "Invalid start_date. Must be YYYY-MM-DD format" },
        { status: 400 }
      )
    }

    if (notes !== undefined && notes !== null && typeof notes !== "string") {
      return NextResponse.json(
        { error: "Invalid notes. Must be a string or null" },
        { status: 400 }
      )
    }

    // Verify assignment exists
    const existing = await getAssignmentById(id)
    if (!existing) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}
    if (status) {
      updates.status = status
      if (status === "cancelled") {
        updates.end_date = new Date().toISOString().slice(0, 10)
      }
    }
    if (start_date !== undefined) updates.start_date = start_date
    if (notes !== undefined) updates.notes = notes

    const updated = await updateAssignment(id, updates)

    return NextResponse.json(updated)
  } catch {
    return NextResponse.json(
      { error: "Failed to update assignment. Please try again." },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await getAssignmentById(id)
    if (!existing) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
    }

    await deleteAssignment(id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Failed to delete assignment. Please try again." },
      { status: 500 }
    )
  }
}
