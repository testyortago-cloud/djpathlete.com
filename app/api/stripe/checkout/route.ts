import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { checkoutSchema } from "@/lib/validators/checkout"
import { getActiveProgramById } from "@/lib/db/programs"
import { getAssignmentByUserAndProgram } from "@/lib/db/assignments"
import { createCheckoutSession } from "@/lib/stripe"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "You must be logged in to purchase a program." },
        { status: 401 }
      )
    }

    const body = await request.json()
    const result = checkoutSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { programId, returnUrl } = result.data

    const program = await getActiveProgramById(programId)
    if (!program) {
      return NextResponse.json(
        { error: "Program not found or is no longer available." },
        { status: 404 }
      )
    }

    // Check if user has an existing assignment
    const existing = await getAssignmentByUserAndProgram(
      session.user.id,
      programId
    )

    // Targeted programs can only be purchased by the targeted client or someone with an assignment
    if (program.target_user_id && program.target_user_id !== session.user.id && !existing) {
      return NextResponse.json(
        { error: "This program is not available for purchase." },
        { status: 403 }
      )
    }

    if (!program.price_cents) {
      return NextResponse.json(
        { error: "This program does not have a price. Please contact us." },
        { status: 400 }
      )
    }

    // Block if user already owns (paid or not_required) — but allow if payment is still pending
    if (existing && existing.payment_status !== "pending") {
      return NextResponse.json(
        { error: "You already own this program." },
        { status: 409 }
      )
    }

    const checkoutSession = await createCheckoutSession(
      program,
      session.user.id,
      returnUrl
    )

    return NextResponse.json({ url: checkoutSession.url })
  } catch (error) {
    console.error("Stripe checkout error:", error)
    return NextResponse.json(
      { error: "Failed to create checkout session. Please try again." },
      { status: 500 }
    )
  }
}
