import { NextResponse } from "next/server"
import type Stripe from "stripe"
import { verifyWebhookSignature } from "@/lib/stripe"
import { createPayment, getPaymentByStripeId, updatePayment } from "@/lib/db/payments"
import { createAssignment, getAssignmentByUserAndProgram, updateAssignment } from "@/lib/db/assignments"
import { getUserById } from "@/lib/db/users"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getProgramById } from "@/lib/db/programs"
import { sendCoachPurchaseNotification } from "@/lib/email"
import { ghlCreateContact, ghlTriggerWorkflow } from "@/lib/ghl"

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

        // Check for existing pending assignment (admin-assigned, awaiting payment)
        const existingAssignment = await getAssignmentByUserAndProgram(userId, programId)

        if (existingAssignment && existingAssignment.payment_status === "pending") {
          // Mark the pending assignment as paid
          await updateAssignment(existingAssignment.id, { payment_status: "paid" })
        } else if (!existingAssignment || existingAssignment.status !== "active") {
          // Create new assignment for direct purchase
          const { getProgramById } = await import("@/lib/db/programs")
          const purchasedProgram = await getProgramById(programId)

          await createAssignment({
            program_id: programId,
            user_id: userId,
            assigned_by: null,
            start_date: new Date().toISOString().split("T")[0],
            end_date: null,
            status: "active",
            notes: null,
            current_week: 1,
            total_weeks: purchasedProgram.duration_weeks ?? null,
            payment_status: "paid",
          })
        }

        // Sync purchase to GoHighLevel (non-blocking)
        try {
          const customerEmail = session.customer_details?.email
          if (customerEmail) {
            const contact = await ghlCreateContact({
              email: customerEmail,
              firstName: session.customer_details?.name?.split(" ")[0],
              lastName: session.customer_details?.name?.split(" ").slice(1).join(" ") || undefined,
              tags: ["purchased", `program-${programId}`],
              source: "stripe-purchase",
            })
            if (contact?.id && process.env.GHL_WORKFLOW_NEW_PURCHASE) {
              await ghlTriggerWorkflow(contact.id, process.env.GHL_WORKFLOW_NEW_PURCHASE)
            }
          }
        } catch {
          // GHL sync failure should not affect payment processing
        }

        // Notify coach/admin about the purchase (non-blocking)
        try {
          const [client, profile, program] = await Promise.all([
            getUserById(userId),
            getProfileByUserId(userId),
            getProgramById(programId),
          ])

          const coachEmail = process.env.COACH_EMAIL ?? "sales@darrenjpaul.com"
          const coachFirstName = process.env.COACH_FIRST_NAME ?? "Coach"

          await sendCoachPurchaseNotification({
            coachEmail,
            coachFirstName,
            clientName: `${client.first_name} ${client.last_name}`.trim(),
            clientEmail: client.email,
            clientId: userId,
            programName: program?.name ?? "Unknown Program",
            amountFormatted: `$${((session.amount_total ?? 0) / 100).toFixed(2)}`,
            hasQuestionnaire: !!(profile?.goals && profile.goals.trim().length > 0),
          })
        } catch {
          // Coach notification failure should not affect payment processing
        }

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
