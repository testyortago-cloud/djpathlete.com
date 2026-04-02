import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getProgramById, updateProgram } from "@/lib/db/programs"
import { getActiveAssignmentsForProgram, updateAssignment } from "@/lib/db/assignments"
import { createWeekAccessBulk } from "@/lib/db/week-access"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Unauthorized. Admin access required." },
        { status: 403 }
      )
    }

    const { id } = await params

    // Parse optional body for access type + price
    let accessType: "included" | "paid" = "included"
    let priceCents: number | null = null
    try {
      const body = await request.json()
      if (body.access_type === "paid" && body.price_cents > 0) {
        accessType = "paid"
        priceCents = body.price_cents
      }
    } catch {
      // No body or invalid JSON — default to included
    }

    const program = await getProgramById(id)
    const newDuration = (program.duration_weeks ?? 1) + 1

    await updateProgram(id, { duration_weeks: newDuration })

    // Update all active assignments and create week access records
    const activeAssignments = await getActiveAssignmentsForProgram(id)
    if (activeAssignments.length > 0) {
      await Promise.all(
        activeAssignments.map((a) =>
          updateAssignment(a.id, { total_weeks: newDuration })
        )
      )

      // Create week access records for the new week
      await createWeekAccessBulk(
        activeAssignments.map((a) => ({
          assignment_id: a.id,
          week_number: newDuration,
          access_type: accessType,
          price_cents: priceCents,
          payment_status: accessType === "included" ? "not_required" as const : "pending" as const,
          stripe_session_id: null,
          stripe_payment_id: null,
        }))
      )
    }

    return NextResponse.json(
      {
        new_week_number: newDuration,
        access_type: accessType,
        price_cents: priceCents,
        assignments_updated: activeAssignments.length,
      },
      { status: 200 }
    )
  } catch {
    return NextResponse.json(
      { error: "Failed to add week. Please try again." },
      { status: 500 }
    )
  }
}
