import { NextResponse } from "next/server"
import { getAssignmentById, updateAssignment, deleteAssignment } from "@/lib/db/assignments"
import { withAudit } from "@/lib/audit/with-audit"
import { recordAudit } from "@/lib/audit/record"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const { status, start_date, notes, payment_status, expires_at } = body

    // Must provide at least one field to update
    if (
      !status &&
      start_date === undefined &&
      notes === undefined &&
      payment_status === undefined &&
      expires_at === undefined
    ) {
      return NextResponse.json({ error: "No update fields provided" }, { status: 400 })
    }

    if (status && !["active", "paused", "cancelled"].includes(status)) {
      return NextResponse.json({ error: "Invalid status. Must be one of: active, paused, cancelled" }, { status: 400 })
    }

    if (start_date !== undefined && (typeof start_date !== "string" || !DATE_RE.test(start_date))) {
      return NextResponse.json({ error: "Invalid start_date. Must be YYYY-MM-DD format" }, { status: 400 })
    }

    if (notes !== undefined && notes !== null && typeof notes !== "string") {
      return NextResponse.json({ error: "Invalid notes. Must be a string or null" }, { status: 400 })
    }

    if (payment_status && !["not_required", "pending", "paid", "subscription_active"].includes(payment_status)) {
      return NextResponse.json({ error: "Invalid payment_status" }, { status: 400 })
    }

    if (expires_at !== undefined && expires_at !== null) {
      const d = new Date(expires_at)
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid expires_at. Must be a valid date string or null" }, { status: 400 })
      }
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
    if (payment_status) updates.payment_status = payment_status
    if (expires_at !== undefined) updates.expires_at = expires_at

    const updated = await updateAssignment(id, updates)

    // Audit: slug depends on payload — status change vs general update.
    void recordAudit({
      action: status ? "assignment.status_changed" : "assignment.updated",
      category: "admin_write",
      target: { type: "assignment", id },
      metadata: status
        ? { new_status: status }
        : { changed: Object.keys(body) },
      request,
    })

    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: "Failed to update assignment. Please try again." }, { status: 500 })
  }
}

export const DELETE = withAudit(
  {
    action: "assignment.deleted",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "assignment", id }
    },
  },
  async (_request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    try {
      const { id } = await params

      const existing = await getAssignmentById(id)
      if (!existing) {
        return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
      }

      await deleteAssignment(id)
      return NextResponse.json({ success: true })
    } catch {
      return NextResponse.json({ error: "Failed to delete assignment. Please try again." }, { status: 500 })
    }
  },
)
