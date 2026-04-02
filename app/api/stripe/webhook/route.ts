import { NextResponse } from "next/server"
import type Stripe from "stripe"
import { verifyWebhookSignature } from "@/lib/stripe"
import { createPayment, getPaymentByStripeId, updatePayment } from "@/lib/db/payments"
import { createAssignment, getAssignmentByUserAndProgram, updateAssignment } from "@/lib/db/assignments"
import { updateWeekAccess, createWeekAccessBulk } from "@/lib/db/week-access"
import {
  createSubscription,
  getSubscriptionByStripeId,
  updateSubscriptionByStripeId,
} from "@/lib/db/subscriptions"
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

        // Per-week payment
        if (session.metadata?.type === "week_access") {
          await handleWeekAccessCheckout(session)
          break
        }

        if (session.mode === "subscription") {
          await handleSubscriptionCheckout(session)
        } else {
          await handleOneTimeCheckout(session)
        }
        break
      }

      case "invoice.payment_succeeded": {
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice)
        break
      }

      case "invoice.payment_failed": {
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
        break
      }

      case "customer.subscription.updated": {
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break
      }

      case "customer.subscription.deleted": {
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
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

// ─── One-time payment (existing logic, extracted) ────────────────────────────

async function handleOneTimeCheckout(session: Stripe.Checkout.Session) {
  const programId = session.metadata?.programId
  const userId = session.metadata?.userId
  const stripePaymentId = session.payment_intent as string

  if (!programId || !userId || !stripePaymentId) return

  // Idempotency: skip if already processed
  const existing = await getPaymentByStripeId(stripePaymentId)
  if (existing) return

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
    const purchasedProgram = await getProgramById(programId)
    const totalWeeks = purchasedProgram.duration_weeks ?? 1

    const assignment = await createAssignment({
      program_id: programId,
      user_id: userId,
      assigned_by: null,
      start_date: new Date().toISOString().split("T")[0],
      end_date: null,
      status: "active",
      notes: null,
      current_week: 1,
      total_weeks: totalWeeks,
      payment_status: "paid",
      expires_at: null,
    })

    // Auto-create week access records for all weeks (included/free)
    await createWeekAccessBulk(
      Array.from({ length: totalWeeks }, (_, i) => ({
        assignment_id: assignment.id,
        week_number: i + 1,
        access_type: "included" as const,
        price_cents: null,
        payment_status: "not_required" as const,
        stripe_session_id: null,
        stripe_payment_id: null,
      }))
    )
  }

  // Sync + notify (non-blocking)
  await syncAndNotify(session, programId, userId, "purchased")
}

// ─── Per-week payment ───────────────────────────────────────────────────────

async function handleWeekAccessCheckout(session: Stripe.Checkout.Session) {
  const weekAccessId = session.metadata?.weekAccessId
  const userId = session.metadata?.userId
  const stripePaymentId = session.payment_intent as string

  if (!weekAccessId || !userId || !stripePaymentId) return

  // Idempotency
  const existingPayment = await getPaymentByStripeId(stripePaymentId)
  if (existingPayment) return

  // Mark week as paid
  await updateWeekAccess(weekAccessId, {
    payment_status: "paid",
    stripe_payment_id: stripePaymentId,
    stripe_session_id: session.id,
  })

  // Record payment
  await createPayment({
    user_id: userId,
    stripe_payment_id: stripePaymentId,
    stripe_customer_id: (session.customer as string) ?? null,
    amount_cents: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
    status: "succeeded",
    description: `Week ${session.metadata?.weekNumber} access`,
    metadata: {
      weekAccessId,
      assignmentId: session.metadata?.assignmentId,
      weekNumber: session.metadata?.weekNumber,
    },
  })
}

// ─── Subscription checkout ───────────────────────────────────────────────────

async function handleSubscriptionCheckout(session: Stripe.Checkout.Session) {
  const programId = session.metadata?.programId
  const userId = session.metadata?.userId
  const stripeSubscriptionId = session.subscription as string

  if (!programId || !userId || !stripeSubscriptionId) return

  // Idempotency
  const existingSub = await getSubscriptionByStripeId(stripeSubscriptionId)
  if (existingSub) return

  const program = await getProgramById(programId)

  // Create or update assignment
  const existingAssignment = await getAssignmentByUserAndProgram(userId, programId)
  let assignmentId: string

  if (existingAssignment) {
    await updateAssignment(existingAssignment.id, {
      status: "active",
      payment_status: "subscription_active",
    })
    assignmentId = existingAssignment.id
  } else {
    const totalWeeks = program.duration_weeks ?? 1
    const assignment = await createAssignment({
      program_id: programId,
      user_id: userId,
      assigned_by: null,
      start_date: new Date().toISOString().split("T")[0],
      end_date: null,
      status: "active",
      notes: null,
      current_week: 1,
      total_weeks: totalWeeks,
      payment_status: "subscription_active",
      expires_at: null,
    })
    assignmentId = assignment.id

    // Auto-create week access records for all weeks
    await createWeekAccessBulk(
      Array.from({ length: totalWeeks }, (_, i) => ({
        assignment_id: assignmentId,
        week_number: i + 1,
        access_type: "included" as const,
        price_cents: null,
        payment_status: "not_required" as const,
        stripe_session_id: null,
        stripe_payment_id: null,
      }))
    )
  }

  // Create subscription record
  await createSubscription({
    user_id: userId,
    program_id: programId,
    assignment_id: assignmentId,
    stripe_subscription_id: stripeSubscriptionId,
    stripe_customer_id: (session.customer as string) ?? "",
    status: "active",
    current_period_start: null,
    current_period_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    metadata: { programId },
  })

  // Also create a payment record for the initial charge
  if (session.payment_intent) {
    const existingPayment = await getPaymentByStripeId(session.payment_intent as string)
    if (!existingPayment) {
      await createPayment({
        user_id: userId,
        stripe_payment_id: session.payment_intent as string,
        stripe_customer_id: (session.customer as string) ?? null,
        amount_cents: session.amount_total ?? 0,
        currency: session.currency ?? "usd",
        status: "succeeded",
        description: `Subscription: ${program.name}`,
        metadata: { programId, subscriptionId: stripeSubscriptionId },
      })
    }
  }

  // Sync + notify
  await syncAndNotify(session, programId, userId, "subscriber")
}

// ─── Recurring invoice payment succeeded ─────────────────────────────────────

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  // In Stripe v20+, subscription is nested under parent.subscription_details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceAny = invoice as any
  const subscriptionId: string | undefined =
    invoiceAny.parent?.subscription_details?.subscription
    ?? invoiceAny.subscription
  if (!subscriptionId) return

  // Skip the first invoice (handled by checkout.session.completed)
  if (invoice.billing_reason === "subscription_create") return

  const sub = await getSubscriptionByStripeId(subscriptionId)
  if (!sub) return

  // Record recurring payment for revenue tracking
  const stripePaymentId: string | undefined =
    invoiceAny.payments?.data?.[0]?.payment_intent?.id
    ?? invoiceAny.payment_intent
  if (stripePaymentId) {
    const existingPayment = await getPaymentByStripeId(stripePaymentId)
    if (!existingPayment) {
      await createPayment({
        user_id: sub.user_id,
        stripe_payment_id: stripePaymentId,
        stripe_customer_id: sub.stripe_customer_id,
        amount_cents: invoice.amount_paid ?? 0,
        currency: invoice.currency ?? "usd",
        status: "succeeded",
        description: `Subscription renewal`,
        metadata: { programId: sub.program_id, subscriptionId },
      })
    }
  }

  // Update subscription period
  await updateSubscriptionByStripeId(subscriptionId, {
    status: "active",
    current_period_start: invoice.period_start
      ? new Date(invoice.period_start * 1000).toISOString()
      : null,
    current_period_end: invoice.period_end
      ? new Date(invoice.period_end * 1000).toISOString()
      : null,
  })

  // Ensure assignment is active
  if (sub.assignment_id) {
    await updateAssignment(sub.assignment_id, {
      status: "active",
      payment_status: "subscription_active",
    })
  }
}

// ─── Invoice payment failed ──────────────────────────────────────────────────

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceAny = invoice as any
  const subscriptionId: string | undefined =
    invoiceAny.parent?.subscription_details?.subscription
    ?? invoiceAny.subscription
  if (!subscriptionId) return

  const sub = await getSubscriptionByStripeId(subscriptionId)
  if (!sub) return

  await updateSubscriptionByStripeId(subscriptionId, {
    status: "past_due",
  })

  // Don't immediately revoke access — Stripe retries failed payments
  // The assignment stays active during past_due to give grace period
  console.warn(
    `[Webhook] Subscription ${subscriptionId} payment failed for user ${sub.user_id}`
  )
}

// ─── Subscription updated (status changes, cancellation scheduled) ───────────

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const sub = await getSubscriptionByStripeId(subscription.id)
  if (!sub) return

  const newStatus = subscription.status as string

  // In Stripe v20+, current_period_start/end are on subscription items, not the subscription itself
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subAny = subscription as any
  const periodStart = subAny.current_period_start ?? subAny.items?.data?.[0]?.current_period_start
  const periodEnd = subAny.current_period_end ?? subAny.items?.data?.[0]?.current_period_end

  await updateSubscriptionByStripeId(subscription.id, {
    status: newStatus as "active" | "past_due" | "canceled" | "unpaid" | "incomplete" | "trialing" | "paused",
    cancel_at_period_end: subscription.cancel_at_period_end,
    canceled_at: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000).toISOString()
      : null,
    current_period_start: periodStart
      ? new Date(periodStart * 1000).toISOString()
      : null,
    current_period_end: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : null,
  })

  // If subscription becomes unpaid or canceled, revoke access
  if (newStatus === "unpaid" || newStatus === "canceled") {
    if (sub.assignment_id) {
      await updateAssignment(sub.assignment_id, {
        status: "cancelled",
        payment_status: "pending",
      })
    }
  }
}

// ─── Subscription deleted (fully cancelled) ─────────────────────────────────

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const sub = await getSubscriptionByStripeId(subscription.id)
  if (!sub) return

  await updateSubscriptionByStripeId(subscription.id, {
    status: "canceled",
    canceled_at: new Date().toISOString(),
  })

  // Revoke program access
  if (sub.assignment_id) {
    await updateAssignment(sub.assignment_id, {
      status: "cancelled",
      payment_status: "pending",
    })
  }
}

// ─── Shared: GHL sync + coach notification ───────────────────────────────────

async function syncAndNotify(
  session: Stripe.Checkout.Session,
  programId: string,
  userId: string,
  tag: string
) {
  // Sync purchase to GoHighLevel (non-blocking)
  try {
    const customerEmail = session.customer_details?.email
    if (customerEmail) {
      const contact = await ghlCreateContact({
        email: customerEmail,
        firstName: session.customer_details?.name?.split(" ")[0],
        lastName: session.customer_details?.name?.split(" ").slice(1).join(" ") || undefined,
        tags: [tag, `program-${programId}`],
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
}
