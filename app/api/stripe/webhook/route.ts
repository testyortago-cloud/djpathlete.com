import { NextResponse } from "next/server"
import type Stripe from "stripe"
import { verifyWebhookSignature } from "@/lib/stripe"
import { createPayment, getPaymentByStripeId, updatePayment } from "@/lib/db/payments"
import { createAssignment } from "@/lib/db/assignments"

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    )
  }

  let event: Stripe.Event
  try {
    event = verifyWebhookSignature(body, signature)
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 400 }
    )
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const programId = session.metadata?.programId
        const userId = session.metadata?.userId
        const stripePaymentId = session.payment_intent as string

        if (!programId || !userId || !stripePaymentId) break

        // Idempotency: skip if already processed
        const existing = await getPaymentByStripeId(stripePaymentId)
        if (existing) break

        await createPayment({
          user_id: userId,
          stripe_payment_id: stripePaymentId,
          stripe_customer_id: (session.customer as string) ?? null,
          amount_cents: session.amount_total ?? 0,
          currency: session.currency ?? "usd",
          status: "succeeded",
          description: `Program purchase`,
          metadata: { programId },
        })

        await createAssignment({
          program_id: programId,
          user_id: userId,
          assigned_by: null,
          start_date: new Date().toISOString().split("T")[0],
          end_date: null,
          status: "active",
          notes: null,
        })

        break
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge
        const stripePaymentId = charge.payment_intent as string

        if (!stripePaymentId) break

        const payment = await getPaymentByStripeId(stripePaymentId)
        if (payment) {
          await updatePayment(payment.id, { status: "refunded" })
        }

        break
      }
    }
  } catch (err) {
    console.error("Webhook processing error:", err)
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    )
  }

  return NextResponse.json({ received: true })
}
