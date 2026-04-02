import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { weekCheckoutSchema } from "@/lib/validators/week-access"
import { getWeekAccess } from "@/lib/db/week-access"
import { getAssignmentById } from "@/lib/db/assignments"
import { getProgramById } from "@/lib/db/programs"
import { createWeekCheckoutSession } from "@/lib/stripe"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "You must be logged in." },
        { status: 401 }
      )
    }

    const body = await request.json()
    const result = weekCheckoutSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { assignmentId, weekNumber } = result.data

    // Verify assignment belongs to this user
    const assignment = await getAssignmentById(assignmentId)
    if (assignment.user_id !== session.user.id) {
      return NextResponse.json(
        { error: "Not authorized." },
        { status: 403 }
      )
    }

    // Get week access record
    const weekAccess = await getWeekAccess(assignmentId, weekNumber)
    if (!weekAccess) {
      return NextResponse.json(
        { error: "Week access record not found." },
        { status: 404 }
      )
    }

    if (weekAccess.payment_status === "paid" || weekAccess.payment_status === "not_required") {
      return NextResponse.json(
        { error: "This week is already accessible." },
        { status: 409 }
      )
    }

    if (!weekAccess.price_cents || weekAccess.price_cents <= 0) {
      return NextResponse.json(
        { error: "No price set for this week. Contact your coach." },
        { status: 400 }
      )
    }

    const program = await getProgramById(assignment.program_id)

    const checkoutSession = await createWeekCheckoutSession({
      programName: program.name,
      weekNumber,
      priceCents: weekAccess.price_cents,
      userId: session.user.id,
      assignmentId,
      weekAccessId: weekAccess.id,
    })

    return NextResponse.json({ url: checkoutSession.url })
  } catch (error) {
    console.error("Week checkout error:", error)
    return NextResponse.json(
      { error: "Failed to create checkout session. Please try again." },
      { status: 500 }
    )
  }
}
