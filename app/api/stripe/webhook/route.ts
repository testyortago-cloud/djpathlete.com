import { NextResponse } from "next/server"
import type Stripe from "stripe"
import { verifyWebhookSignature, resolveSessionPaymentIntent, stripe } from "@/lib/stripe"
import { createPayment, getPaymentByStripeId, updatePayment } from "@/lib/db/payments"
import { findAttributionByEmail } from "@/lib/db/marketing-attribution"
import { createAssignment, getAssignmentByUserAndProgram, updateAssignment } from "@/lib/db/assignments"
import { updateWeekAccess, createWeekAccessBulk } from "@/lib/db/week-access"
import { createSubscription, getSubscriptionByStripeId, updateSubscriptionByStripeId } from "@/lib/db/subscriptions"
import { getUserById, getUserByEmail } from "@/lib/db/users"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getProgramById } from "@/lib/db/programs"
import {
  sendCoachPurchaseNotification,
  sendEventSignupConfirmedEmail,
  sendEventSignupOverbookRefundEmail,
} from "@/lib/email"
import { ghlCreateContact, ghlTriggerWorkflow } from "@/lib/ghl"
import { confirmSignup, cancelSignup, getSignupById, getEventSignupByPaymentIntent } from "@/lib/db/event-signups"
import { handleShopOrderCheckout } from "@/lib/shop/webhooks"
import { getEventById as getEventByIdForSignup } from "@/lib/db/events"
import { createServiceRoleClient as createSupabaseServiceClient } from "@/lib/supabase"

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = verifyWebhookSignature(body, signature)
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session

        if (session.metadata?.type === "shop_order") {
          await handleShopOrderCheckout(session)
          break
        }

        if (session.metadata?.type === "event_signup") {
          await handleEventSignupCheckout(session)
          break
        }

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

        if (stripePaymentId) {
          const payment = await getPaymentByStripeId(stripePaymentId)
          if (payment) {
            await updatePayment(payment.id, { status: "refunded" })
          }

          // Check if this refund matches an event signup
          await handleEventSignupRefund(stripePaymentId)
        }

        break
      }
    }
  } catch (err) {
    console.error("Webhook processing error:", err)
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

// ─── Email-based user lookup helper ─────────────────────────────────────────

async function tryResolveUserIdFromEmail(email: string | null | undefined): Promise<string | null> {
  if (!email) return null
  try {
    const user = await getUserByEmail(email)
    return user?.id ?? null
  } catch {
    return null
  }
}

// ─── Tracking params resolver ────────────────────────────────────────────────

interface TrackingValues {
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
}

async function resolveTrackingParams(
  sessionMetadata: Record<string, string>,
  customerEmail: string | null | undefined,
): Promise<TrackingValues> {
  // Use || (not ??) so empty strings from Stripe metadata are treated as missing
  let gclid  = sessionMetadata.gclid  || null
  let gbraid = sessionMetadata.gbraid || null
  let wbraid = sessionMetadata.wbraid || null
  let fbclid = sessionMetadata.fbclid || null

  if (!gclid && customerEmail) {
    const attr = await findAttributionByEmail(customerEmail).catch(() => null)
    if (attr) {
      gclid  = attr.gclid
      gbraid = gbraid || attr.gbraid
      wbraid = wbraid || attr.wbraid
      fbclid = fbclid || attr.fbclid
    }
  }

  return { gclid, gbraid, wbraid, fbclid }
}

// ─── One-time payment (existing logic, extracted) ────────────────────────────

async function handleOneTimeCheckout(session: Stripe.Checkout.Session) {
  const programId = session.metadata?.programId
  const userId = session.metadata?.userId
  const stripePaymentId = session.payment_intent as string

  if (!stripePaymentId) return

  // External Stripe checkout (Payment Link, dashboard, etc.) — capture as
  // a record-keeping payment with no internal program/assignment wiring.
  if (!programId || !userId) {
    const existing = await getPaymentByStripeId(stripePaymentId)
    if (existing) return
    const customerEmail = session.customer_details?.email
    const resolvedUserId = await tryResolveUserIdFromEmail(customerEmail)
    const tracking = await resolveTrackingParams(session.metadata ?? {}, customerEmail)
    await createPayment({
      user_id: resolvedUserId,
      stripe_payment_id: stripePaymentId,
      stripe_customer_id: (session.customer as string) ?? null,
      amount_cents: session.amount_total ?? 0,
      currency: session.currency ?? "usd",
      status: "succeeded",
      description: "External Stripe checkout",
      metadata: {
        source: "external",
        sessionId: session.id,
        customerEmail: customerEmail ?? null,
      },
      ...tracking,
    })
    return
  }

  // Idempotency: skip if already processed
  const existing = await getPaymentByStripeId(stripePaymentId)
  if (existing) return

  const tracking = await resolveTrackingParams(session.metadata ?? {}, session.customer_details?.email)
  await createPayment({
    user_id: userId,
    stripe_payment_id: stripePaymentId,
    stripe_customer_id: (session.customer as string) ?? null,
    amount_cents: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
    status: "succeeded",
    description: `Program purchase`,
    metadata: { programId },
    ...tracking,
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
      })),
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
  const weekTracking = await resolveTrackingParams(session.metadata ?? {}, session.customer_details?.email)
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
    ...weekTracking,
  })
}

// ─── Subscription checkout ───────────────────────────────────────────────────

async function handleSubscriptionCheckout(session: Stripe.Checkout.Session) {
  const programId = session.metadata?.programId
  const userId = session.metadata?.userId
  const stripeSubscriptionId = session.subscription as string

  if (!stripeSubscriptionId) return

  // External Stripe subscription (Payment Link, dashboard, etc.) — capture
  // the subscription + initial payment without internal program wiring.
  if (!programId || !userId) {
    const existingSub = await getSubscriptionByStripeId(stripeSubscriptionId)
    if (existingSub) return

    const resolvedUserId = await tryResolveUserIdFromEmail(session.customer_details?.email)
    await createSubscription({
      user_id: resolvedUserId,
      program_id: null,
      assignment_id: null,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_customer_id: (session.customer as string) ?? "",
      status: "active",
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      canceled_at: null,
      metadata: {
        source: "external",
        sessionId: session.id,
        customerEmail: session.customer_details?.email ?? null,
      },
    })

    const stripePaymentId = await resolveSessionPaymentIntent(session)
    if (stripePaymentId) {
      const existingPayment = await getPaymentByStripeId(stripePaymentId)
      if (!existingPayment) {
        const extTracking = await resolveTrackingParams(session.metadata ?? {}, session.customer_details?.email)
        await createPayment({
          user_id: resolvedUserId,
          stripe_payment_id: stripePaymentId,
          stripe_customer_id: (session.customer as string) ?? null,
          amount_cents: session.amount_total ?? 0,
          currency: session.currency ?? "usd",
          status: "succeeded",
          description: "External subscription (initial)",
          metadata: {
            source: "external",
            sessionId: session.id,
            subscriptionId: stripeSubscriptionId,
          },
          ...extTracking,
        })
      }
    }
    return
  }

  // Existing idempotency check (now reached only when programId + userId are present)
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
      })),
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
  const stripePaymentId = await resolveSessionPaymentIntent(session)
  if (stripePaymentId) {
    const existingPayment = await getPaymentByStripeId(stripePaymentId)
    if (!existingPayment) {
      const subTracking = await resolveTrackingParams(session.metadata ?? {}, session.customer_details?.email)
      await createPayment({
        user_id: userId,
        stripe_payment_id: stripePaymentId,
        stripe_customer_id: (session.customer as string) ?? null,
        amount_cents: session.amount_total ?? 0,
        currency: session.currency ?? "usd",
        status: "succeeded",
        description: `Subscription: ${program.name}`,
        metadata: { programId, subscriptionId: stripeSubscriptionId },
        ...subTracking,
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
    invoiceAny.parent?.subscription_details?.subscription ?? invoiceAny.subscription
  if (!subscriptionId) return

  // Skip the first invoice (handled by checkout.session.completed)
  if (invoice.billing_reason === "subscription_create") return

  const sub = await getSubscriptionByStripeId(subscriptionId)
  if (!sub) return

  // Record recurring payment for revenue tracking
  const stripePaymentId: string | undefined =
    invoiceAny.payments?.data?.[0]?.payment_intent?.id ?? invoiceAny.payment_intent
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
        // Recurring invoice renewals don't have a checkout session; gclid was
        // captured on the original subscription checkout.
        gclid: null,
        gbraid: null,
        wbraid: null,
        fbclid: null,
      })
    }
  }

  // Update subscription period
  await updateSubscriptionByStripeId(subscriptionId, {
    status: "active",
    current_period_start: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
    current_period_end: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
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
    invoiceAny.parent?.subscription_details?.subscription ?? invoiceAny.subscription
  if (!subscriptionId) return

  const sub = await getSubscriptionByStripeId(subscriptionId)
  if (!sub) return

  await updateSubscriptionByStripeId(subscriptionId, {
    status: "past_due",
  })

  // Don't immediately revoke access — Stripe retries failed payments
  // The assignment stays active during past_due to give grace period
  console.warn(`[Webhook] Subscription ${subscriptionId} payment failed for user ${sub.user_id}`)
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
    canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
    current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
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

async function syncAndNotify(session: Stripe.Checkout.Session, programId: string, userId: string, tag: string) {
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

// ─── Event signup checkout ────────────────────────────────────────────────────

async function handleEventSignupCheckout(session: Stripe.Checkout.Session) {
  const signupId = session.metadata?.event_signup_id
  if (!signupId) {
    console.error("[webhook event_signup] missing event_signup_id in metadata")
    return
  }

  const result = await confirmSignup(signupId)
  if (!result.ok) {
    if (result.reason === "at_capacity") {
      // Race: someone else's confirm beat this one to the last slot. The
      // customer has already paid Stripe, so we owe them an immediate refund
      // and an apology. The signup row is left as 'pending' until the refund
      // succeeds, then flipped to 'refunded'.
      await handleEventSignupOverbook(session, signupId)
      return
    }
    if (result.reason !== "not_pending") {
      console.error(`[webhook event_signup] confirmSignup failed: ${result.reason} for signup ${signupId}`)
    }
    return
  }

  const supabase = createSupabaseServiceClient()
  await supabase
    .from("event_signups")
    .update({
      stripe_payment_intent_id: session.payment_intent,
      amount_paid_cents: session.amount_total,
      updated_at: new Date().toISOString(),
    })
    .eq("id", signupId)

  const updated = await getSignupById(signupId)
  const eventId = session.metadata?.event_id
  if (updated && eventId) {
    const ev = await getEventByIdForSignup(eventId)
    if (ev) {
      try {
        await sendEventSignupConfirmedEmail(updated, ev)
      } catch (err) {
        console.error(`[webhook event_signup] email failed for signup ${signupId}`, err)
      }
    }
  }
}

// ─── Event signup overbook (race-loss after payment) ─────────────────────────

async function handleEventSignupOverbook(
  session: Stripe.Checkout.Session,
  signupId: string,
) {
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null
  if (!paymentIntentId) {
    console.error(`[webhook event_signup overbook] no payment_intent on session for signup ${signupId}`)
    return
  }

  try {
    await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: "requested_by_customer",
      metadata: { reason_detail: "event_overbook_after_payment", event_signup_id: signupId },
    })
  } catch (err) {
    console.error(`[webhook event_signup overbook] refund failed for ${signupId}`, err)
    return
  }

  const supabase = createSupabaseServiceClient()
  await supabase
    .from("event_signups")
    .update({
      status: "refunded",
      stripe_payment_intent_id: paymentIntentId,
      amount_paid_cents: session.amount_total,
      updated_at: new Date().toISOString(),
    })
    .eq("id", signupId)

  const signup = await getSignupById(signupId)
  const eventId = session.metadata?.event_id
  if (signup && eventId) {
    const ev = await getEventByIdForSignup(eventId)
    if (ev) {
      try {
        await sendEventSignupOverbookRefundEmail(signup, ev)
      } catch (err) {
        console.error(`[webhook event_signup overbook] email failed for ${signupId}`, err)
      }
    }
  }
}

// ─── Event signup refund ──────────────────────────────────────────────────────

async function handleEventSignupRefund(paymentIntentId: string) {
  const signup = await getEventSignupByPaymentIntent(paymentIntentId)
  if (!signup) return
  if (signup.status === "refunded") return

  if (signup.status === "confirmed") {
    const result = await cancelSignup(signup.id)
    if (!result.ok) {
      console.error(`[webhook event refund] cancelSignup failed: ${result.reason}`)
    }
  }

  const supabase = createSupabaseServiceClient()
  await supabase
    .from("event_signups")
    .update({ status: "refunded", updated_at: new Date().toISOString() })
    .eq("id", signup.id)
}
