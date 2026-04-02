import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getActiveAssignmentsForProgram } from "@/lib/db/assignments"
import {
  getWeekAccessByAssignment,
  createWeekAccess,
  updateWeekAccess,
} from "@/lib/db/week-access"
import { weekAccessSchema } from "@/lib/validators/week-access"

/** GET — Fetch all week access records for all active assignments on a program */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const { id } = await params
    const assignments = await getActiveAssignmentsForProgram(id)

    const accessByAssignment: Record<string, Awaited<ReturnType<typeof getWeekAccessByAssignment>>> = {}
    await Promise.all(
      assignments.map(async (a) => {
        accessByAssignment[a.id] = await getWeekAccessByAssignment(a.id)
      })
    )

    return NextResponse.json({ assignments, accessByAssignment })
  } catch {
    return NextResponse.json({ error: "Failed to fetch week access" }, { status: 500 })
  }
}

/** PUT — Update a specific week access record (change type, price) */
export async function PUT(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const body = await request.json()
    const { weekAccessId, ...updates } = body

    if (!weekAccessId) {
      return NextResponse.json({ error: "weekAccessId is required" }, { status: 400 })
    }

    const parsed = weekAccessSchema.safeParse(updates)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const updateData: Parameters<typeof updateWeekAccess>[1] = {
      access_type: parsed.data.access_type,
      price_cents: parsed.data.price_cents ?? null,
    }

    // If changing to included, auto-clear payment requirement
    if (parsed.data.access_type === "included") {
      updateData.payment_status = "not_required"
      updateData.price_cents = null
    } else if (parsed.data.access_type === "paid") {
      updateData.payment_status = "pending"
    }

    const updated = await updateWeekAccess(weekAccessId, updateData)
    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: "Failed to update week access" }, { status: 500 })
  }
}

/** POST — Grant free access to a specific week for an assignment */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const body = await request.json()
    const { assignmentId, weekNumber, action } = body

    if (!assignmentId || !weekNumber) {
      return NextResponse.json({ error: "assignmentId and weekNumber required" }, { status: 400 })
    }

    if (action === "grant_free") {
      // Create or update week access to be free
      const existing = await import("@/lib/db/week-access").then(m => m.getWeekAccess(assignmentId, weekNumber))
      if (existing) {
        const updated = await updateWeekAccess(existing.id, {
          access_type: "included",
          payment_status: "not_required",
          price_cents: null,
        })
        return NextResponse.json(updated)
      } else {
        const created = await createWeekAccess({
          assignment_id: assignmentId,
          week_number: weekNumber,
          access_type: "included",
          price_cents: null,
          payment_status: "not_required",
          stripe_session_id: null,
          stripe_payment_id: null,
        })
        return NextResponse.json(created, { status: 201 })
      }
    }

    if (action === "mark_paid") {
      // Admin manually marks as paid (e.g., received cash/Venmo)
      const existing = await import("@/lib/db/week-access").then(m => m.getWeekAccess(assignmentId, weekNumber))
      if (existing) {
        const updated = await updateWeekAccess(existing.id, {
          payment_status: "paid",
        })
        return NextResponse.json(updated)
      }
      return NextResponse.json({ error: "Week access record not found" }, { status: 404 })
    }

    if (action === "lock_week") {
      const priceCents = body.price_cents
      if (!priceCents || priceCents <= 0) {
        return NextResponse.json({ error: "Price is required" }, { status: 400 })
      }

      const existing = await import("@/lib/db/week-access").then(m => m.getWeekAccess(assignmentId, weekNumber))
      if (existing) {
        const updated = await updateWeekAccess(existing.id, {
          access_type: "paid",
          price_cents: priceCents,
          payment_status: "pending",
        })
        return NextResponse.json(updated)
      } else {
        const created = await createWeekAccess({
          assignment_id: assignmentId,
          week_number: weekNumber,
          access_type: "paid",
          price_cents: priceCents,
          payment_status: "pending",
          stripe_session_id: null,
          stripe_payment_id: null,
        })
        return NextResponse.json(created, { status: 201 })
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch {
    return NextResponse.json({ error: "Failed to manage week access" }, { status: 500 })
  }
}
