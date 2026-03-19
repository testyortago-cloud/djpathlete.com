import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { checkoutSchema } from "@/lib/validators/checkout"
import { getActiveProgramById } from "@/lib/db/programs"
import { getAssignmentByUserAndProgram } from "@/lib/db/assignments"
import { getActiveSubscription } from "@/lib/db/subscriptions"
import { isAssignmentExpired } from "@/lib/utils"
import {
  createCheckoutSession,
  createSubscriptionCheckoutSession,
  getOrCreateStripeCustomer,
} from "@/lib/stripe"

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

    // Free programs should not go through checkout
    if (program.payment_type === "free") {
      return NextResponse.json(
        { error: "This program is free and does not require payment." },
        { status: 400 }
      )
    }

    // Check if user has an existing assignment
    const existing = await getAssignmentByUserAndProgram(
      session.user.id,
      programId
    )

    // Private programs can only be purchased by assigned clients
    if (!program.is_public && !existing) {
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

    // Block if user already owns (paid or subscription_active) — but allow if payment is still pending or expired
    if (existing && existing.payment_status !== "pending" && !isAssignmentExpired(existing.expires_at)) {
      return NextResponse.json(
        { error: "You already own this program." },
        { status: 409 }
      )
    }

    // For subscriptions, also check for active subscription
    if (program.payment_type === "subscription") {
      const activeSub = await getActiveSubscription(session.user.id, programId)
      if (activeSub) {
        return NextResponse.json(
          { error: "You already have an active subscription for this program." },
          { status: 409 }
        )
      }

      // Subscription checkout requires a Stripe Customer
      const customerId = await getOrCreateStripeCustomer(
        session.user.id,
        session.user.email!
      )

      const checkoutSession = await createSubscriptionCheckoutSession(
        program,
        customerId,
        session.user.id,
        returnUrl
      )

      return NextResponse.json({ url: checkoutSession.url })
    }

    // One-time payment (existing flow)
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
