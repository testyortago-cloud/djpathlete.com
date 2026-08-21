import { NextResponse } from "next/server"
import type Stripe from "stripe"
import { verifyWebhookSignature, resolveSessionPaymentIntent, retrieveSetupCard, stripe } from "@/lib/stripe"
import { upsertDefaultPaymentMethod } from "@/lib/db/payment-methods"
import { resolveBillingUserId } from "@/lib/services/billing-payer"
import {
  createClientMembership,
  getMembershipBySubscriptionId,
  updateMembershipBySubscriptionId,
} from "@/lib/db/client-memberships"
import { sessionMembershipsEnabled, cardOnFileEnabled } from "@/lib/packs/flags"

/**
 * Membership lookup that is a no-op when the feature is off. Keeps the four
 * subscription webhook handlers from touching `client_memberships` (which may
 * not exist until the migration is applied) for existing PROGRAM subscriptions.
 */
async function membershipForSub(subscriptionId: string) {
  if (!(await sessionMembershipsEnabled())) return null
  return getMembershipBySubscriptionId(subscriptionId)
}
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
import {
  getPackageByStripeSession,
  getPackageByStripePaymentId,
  updateClientPackage,
} from "@/lib/db/client-packages"
import { activatePaidPackage } from "@/lib/services/session-credits"
import { createServiceRoleClient as createSupabaseServiceClient } from "@/lib/supabase"
import { enqueuePaymentValueAdjustmentByEmail } from "@/lib/ads/conversions"
import { recordAudit } from "@/lib/audit/record"
import { getSetting } from "@/lib/db/system-settings"
import { FUNNEL_CHECKOUT_FLAG, FUNNEL_CHECKOUT_DEFAULT } from "@/lib/funnels/checkout/flag"
import { findContactByIdentifiers } from "@/lib/db/contacts"
import { exitRunsForContact } from "@/lib/db/sequences"
import { applyPipelineEvent } from "@/lib/db/pipeline"
import { NON_COACHING_PAYMENT_TYPES } from "@/lib/lead-engine/constants"
import { captureLead } from "@/lib/lead-engine/capture"

// Lead Engine: `checkout.session.completed` fires for every kind of money
// this business takes, not just a coaching sale — merch, event tickets, and
// a $0 card-on-file setup all come through here too. Winning a pipeline
// card is specific to a coaching sale (spec §2.1: "a contact books a
// consult OR completes a checkout" — a coaching checkout), so
// `applyPipelineEvent` below excludes these by `session.metadata?.type`
// rather than trying to enumerate every coaching type (a new coaching
// checkout that forgets to set `type` must still win its card, not
// silently go missing from the board).
//
// This is every non-coaching `checkout.session.completed` type this route
// currently dispatches on — confirmed by reading every
// `session.metadata?.type` branch below, not guessed:
//   - "shop_order": merch — lib/shop/webhooks.ts, revenue tracked in
//     `shop_orders`, never `payments`.
//   - "event_signup": a ticket, not a coaching deal — recordEventSignupPayment
//     below.
//   - "save_card": a card-on-file setup with `amount_total` of 0 — no sale
//     happened at all.
const NON_COACHING_CHECKOUT_TYPES = new Set(["shop_order", "event_signup", "save_card"])

// Plan 3.4 — Stripe webhook audit instrumentation. Only the event types in
// this map get audited; others (e.g. payment_intent.*) pass through silently.
const stripeAuditSlugByType: Record<string, string> = {
  "checkout.session.completed":    "stripe.checkout_completed",
  "customer.subscription.created": "stripe.subscription_created",
  "customer.subscription.updated": "stripe.subscription_updated",
  "customer.subscription.deleted": "stripe.subscription_canceled",
  "invoice.payment_succeeded":     "stripe.payment_succeeded",
  "invoice.payment_failed":        "stripe.payment_failed",
  "charge.refunded":               "stripe.refund",
}

/**
 * Plan 1.5d — fires after a booking-relevant Stripe payment so the matching
 * Google Ads click conversion gets RESTATED to the actual paid value. Email
 * resolves booking → click conversion. Wrapped in try/catch so a Google Ads
 * enqueue failure can't break the Stripe webhook (which would cause Stripe
 * to retry the whole webhook unnecessarily).
 */
async function tryEnqueueAdsValueAdjustment(session: Stripe.Checkout.Session): Promise<void> {
  const email = session.customer_details?.email
  const amount = session.amount_total ?? 0
  if (!email || amount <= 0) return
  try {
    await enqueuePaymentValueAdjustmentByEmail({
      email,
      paid_value_micros: amount * 10_000, // Stripe cents → micros (× 10_000)
      paid_at: new Date().toISOString(),
      currency: (session.currency ?? "usd").toUpperCase(),
    })
  } catch (err) {
    console.error("[stripe-webhook] enqueue Google Ads value adjustment failed:", err)
  }
}

// Lead Engine Stage 4, Task 5 (spec §4, "shop checkout" row): EVERY completed
// checkout is a contact event, not only a coaching sale — merch, event
// tickets, $0 card-on-file setups, memberships, anonymous funnel purchases,
// external Payment Link checkouts, all of it. A paying human is a contact
// regardless of what they bought — deliberately NOT gated by
// NON_COACHING_CHECKOUT_TYPES the way applyPipelineEvent above is (that gate
// answers "is this a coaching sale for the pipeline board"; this answers "did
// a real person just hand over money", which is true for every branch below).
//
// A paid event signup already gets an event_signup capture at row creation
// (Task 4); this adds a SECOND, later timeline entry at payment completion —
// intentional (two real moments on one journey), not a duplicate to dedupe.
//
// captureLead (lib/lead-engine/capture.ts) already never throws — it swallows
// and logs its own write failures. This wrapper still gets its own try/catch,
// matching how tryEnqueueAdsValueAdjustment just above isolates its side
// hook: a webhook that processes real money must never fail (and trigger a
// Stripe retry that replays payment side effects) to fix a contact row.
// Email resolves the same way the existing Lead Engine block above already
// resolves it for findContactByIdentifiers — read and reused, not invented.
// No consent row is written here (a Stripe checkout is not a marketing
// opt-in), and no sequence rides "purchase" in this stage: recordContactEvent
// calls enrollIfTriggered unconditionally, which is a no-op whenever no
// ACTIVE sequence's trigger_source matches the event's source.
//
// metadata: { stripe_session_id: session.id } — Stripe delivers webhooks
// at-least-once (the same "delivered twice" hazard the create-with-outcome
// branch of applyPipelineEvent above is already guarding against with this
// exact session id). Without it, a redelivery writes a second, identical
// contact_timeline_events row with nothing on either row tying it back to
// which checkout produced it — unreconcilable after the fact. This does not
// dedupe the row (append-only spine, intentional per Task 4's ruling on the
// event_signup/purchase overlap); it just makes every row traceable to its
// session, the same way the sibling pipeline hook already tags itself.
async function tryCaptureLeadFromCheckout(session: Stripe.Checkout.Session): Promise<void> {
  try {
    await captureLead({
      source: "purchase",
      email: session.customer_details?.email ?? session.customer_email ?? null,
      name: session.customer_details?.name ?? null,
      metadata: { stripe_session_id: session.id },
    })
  } catch (err) {
    console.error("[stripe-webhook] lead capture failed", (err as Error).message)
  }
}

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

        // Lead Engine: neither the sequence exit nor the pipeline card move
        // may ever fail a payment webhook — catch, log, keep going to the
        // normal response. Stripe retries on a non-2xx response, so a throw
        // here would replay a payment side effect (double-creating
        // assignments, subscriptions, etc.) in order to fix a follow-up
        // email or a board card. One contact resolution, two consumers, same
        // catch — same shape as the GHL booking webhook.
        //
        // exitRunsForContact runs for every completed checkout, unconditionally:
        // any payment — merch, an event ticket, a coaching sale — is a real
        // reason to stop the automated nurture sequence for this person.
        //
        // applyPipelineEvent, by contrast, is gated on
        // NON_COACHING_CHECKOUT_TYPES: winning a pipeline card means "this is
        // a coaching sale", and a shop order, an event ticket, or a $0
        // card-on-file setup is not one — see that constant's comment for the
        // full, confirmed list of what this route dispatches on and why each
        // is excluded. Do not "simplify" these into one shared condition —
        // the two consumers legitimately fire on different subsets of the
        // same resolved contact's checkout.
        try {
          const userId = session.metadata?.userId ?? null
          const email = session.customer_details?.email ?? session.customer_email ?? null
          const contactId = await findContactByIdentifiers({ userId, email })
          if (contactId) {
            await exitRunsForContact(contactId, "payment")
            if (!NON_COACHING_CHECKOUT_TYPES.has(session.metadata?.type ?? "")) {
              // Final review, Important 3: the checkout session id is the
              // source-id idempotency key for the create-with-outcome
              // (instant Won, no prior deal) branch of applyPipelineEvent —
              // the one path the partial unique index cannot protect,
              // because a closed row never matches `WHERE outcome IS NULL`.
              // Stripe delivers at-least-once with no dedupe on this route;
              // two concurrent deliveries of the same session must not mint
              // two Won cards for one sale.
              await applyPipelineEvent({
                contactId,
                event: {
                  kind: "payment",
                  amountCents: session.amount_total ?? 0,
                  currency: session.currency ?? "usd",
                  occurredAt: new Date(),
                },
                metadata: { stripe_session_id: session.id },
              })
            }
          }
        } catch (err) {
          console.error("[stripe-webhook] sequence/pipeline hook failed", (err as Error).message)
        }

        // Lead Engine Stage 4, Task 5: EVERY completed checkout joins the
        // contact spine — see tryCaptureLeadFromCheckout's doc comment.
        // Placed BEFORE every metadata-type branch below so it runs
        // unconditionally, the same way findContactByIdentifiers/
        // exitRunsForContact above it already do.
        await tryCaptureLeadFromCheckout(session)

        if (session.metadata?.type === "shop_order") {
          await handleShopOrderCheckout(session)
          break
        }

        if (session.metadata?.type === "event_signup") {
          await handleEventSignupCheckout(session)
          break
        }

        if (session.metadata?.type === "save_card") {
          await handleSaveCardCheckout(session)
          break
        }

        if (session.metadata?.type === "session_pack") {
          await handleSessionPackCheckout(session)
          await tryEnqueueAdsValueAdjustment(session)
          break
        }

        // Per-week payment
        if (session.metadata?.type === "week_access") {
          await handleWeekAccessCheckout(session)
          await tryEnqueueAdsValueAdjustment(session)
          break
        }

        if (session.metadata?.type === "session_membership") {
          await handleMembershipCheckout(session)
          break
        }

        // ANONYMOUS FUNNEL PURCHASE. This MUST be dispatched before the
        // `mode`/one-time fallthrough below, and not merely for tidiness: a
        // funnel session carries a programId and NO userId, which is exactly
        // the shape `handleOneTimeCheckout` treats as an "External Stripe
        // checkout" — it would record a record-keeping payment and grant
        // nothing at all, silently, on a page that had just taken money.
        if (session.metadata?.type === "funnel_purchase") {
          await handleFunnelPurchaseCheckout(session)
          await tryEnqueueAdsValueAdjustment(session)
          break
        }

        if (session.mode === "subscription") {
          await handleSubscriptionCheckout(session)
        } else {
          await handleOneTimeCheckout(session)
        }
        // Both branches above are booking-relevant funnels (program /
        // coaching purchase). Shop and event_signup cases bail earlier and
        // skip this hook because they aren't tied to a booking outcome.
        await tryEnqueueAdsValueAdjustment(session)
        break
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.metadata?.type === "session_pack") {
          await handleSessionPackExpired(session)
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

          // Check if this refund matches a session pack (non-blocking: a lookup
          // failure here must not 500 the webhook and trigger a Stripe retry).
          try {
            await handleSessionPackRefund(stripePaymentId)
          } catch (err) {
            console.error("[webhook] session pack refund handling failed:", err)
          }

          // Lead Engine (spec §14): a refund reopens nothing — the Won card
          // stays Won — but its value is corrected so §7's campaign-to-revenue
          // report self-heals instead of overstating what this deal actually
          // earned. Contact resolves off the payment row this block already
          // looked up (same "one resolution, one consumer" shape as the
          // checkout.session.completed hook above), gated on `payment`
          // existing since there is nothing to resolve a contact from
          // otherwise. Same never-fail discipline as every other pipeline
          // hook on this route: never fail the webhook to fix a reporting
          // number, and Stripe fires this event for both full AND partial
          // refunds, so this must run unconditionally, not only on a full
          // refund.
          //
          // Fix round 1 (Critical): `getPaymentByStripeId` select("*")s with
          // NO type check — the same `payments` table also carries
          // event-ticket and no-show-fee rows, keyed by `metadata.type`. A
          // contact who separately has a real Won coaching deal and cancels
          // an unrelated event ticket would otherwise subtract the ticket's
          // refund from that coaching card's value_cents. Gated on
          // NON_COACHING_PAYMENT_TYPES — the SAME denylist the reconciler
          // already applies to this identical `payments` join
          // (lib/lead-engine/constants.ts) — rather than a second copy that
          // can drift. Deliberately a denylist: an unlabelled or newly-added
          // coaching payment type must still be handled, not silently
          // skipped.
          const paymentType = payment?.metadata?.type
          const isNonCoachingPayment = typeof paymentType === "string" && NON_COACHING_PAYMENT_TYPES.has(paymentType)
          if (payment && !isNonCoachingPayment) {
            try {
              const contactId = await findContactByIdentifiers({ userId: payment.user_id, email: null })
              if (contactId) {
                await applyPipelineEvent({
                  contactId,
                  event: {
                    kind: "refund",
                    amountRefundedCents: charge.amount_refunded,
                    occurredAt: new Date(),
                  },
                  metadata: { stripe_charge_id: charge.id, amount_refunded: charge.amount_refunded },
                })
              }
            } catch (err) {
              console.error("[stripe-webhook] refund pipeline hook failed", (err as Error).message)
            }
          }
        }

        break
      }
    }

    // Plan 3.4 — record audit row AFTER the event-specific DB writes complete
    // successfully. A thrown handler bypasses this and lands in the catch
    // below, so we never log a false success.
    const auditSlug = stripeAuditSlugByType[event.type]
    if (auditSlug) {
      const object = event.data.object as {
        id?: string
        customer_email?: string | null
        customer?: string | null
      }
      await recordAudit({
        action: auditSlug,
        category: "billing",
        outcome: event.type.endsWith("payment_failed") ? "failure" : "success",
        actor: { id: null, email: "stripe", role: "system" },
        target: {
          type: event.type.startsWith("invoice")
            ? "invoice"
            : event.type.startsWith("customer.subscription")
              ? "subscription"
              : event.type.startsWith("charge")
                ? "charge"
                : "stripe_event",
          id: object.id ?? event.id,
          label: object.customer_email ?? object.customer ?? undefined,
        },
        metadata: {
          stripe_event_id: event.id,
          stripe_event_type: event.type,
        },
        request,
      })
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

// ─── Session membership checkout (auto-withdrawal) ───────────────────────────

async function handleMembershipCheckout(session: Stripe.Checkout.Session) {
  if (!(await sessionMembershipsEnabled())) return
  const userId = session.metadata?.userId
  const planId = session.metadata?.planId ?? null
  const stripeSubscriptionId = session.subscription as string
  if (!userId || !stripeSubscriptionId) return
  if (await getMembershipBySubscriptionId(stripeSubscriptionId)) return // idempotent

  await createClientMembership({
    user_id: userId,
    plan_id: planId,
    stripe_subscription_id: stripeSubscriptionId,
    stripe_customer_id: (session.customer as string) ?? null,
    status: "active",
    current_period_start: null,
    current_period_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
  })

  void recordAudit({
    action: "membership.subscribed",
    category: "commerce",
    outcome: "success",
    actor: { id: null, email: "stripe", role: "system" },
    target: { type: "client_membership", id: stripeSubscriptionId },
    metadata: { user_id: userId, plan_id: planId },
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

  // Session membership renewal — roll the period + reactivate, then done.
  const membershipSucceeded = await membershipForSub(subscriptionId)
  if (membershipSucceeded) {
    await updateMembershipBySubscriptionId(subscriptionId, {
      status: "active",
      current_period_start: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
      current_period_end: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
    })
    return
  }

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

  // Session membership payment failed → past_due (grace, no revoke).
  const membershipFailed = await membershipForSub(subscriptionId)
  if (membershipFailed) {
    await updateMembershipBySubscriptionId(subscriptionId, { status: "past_due" })
    return
  }

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
  // Session membership status/period sync (before program-subscription logic).
  const membershipUpd = await membershipForSub(subscription.id)
  if (membershipUpd) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sa = subscription as any
    const ps = sa.current_period_start ?? sa.items?.data?.[0]?.current_period_start
    const pe = sa.current_period_end ?? sa.items?.data?.[0]?.current_period_end
    await updateMembershipBySubscriptionId(subscription.id, {
      status: subscription.status as never,
      cancel_at_period_end: subscription.cancel_at_period_end,
      canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      current_period_start: ps ? new Date(ps * 1000).toISOString() : null,
      current_period_end: pe ? new Date(pe * 1000).toISOString() : null,
    })
    return
  }

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
  // Session membership fully cancelled.
  const membershipDel = await membershipForSub(subscription.id)
  if (membershipDel) {
    await updateMembershipBySubscriptionId(subscription.id, {
      status: "canceled",
      canceled_at: new Date().toISOString(),
    })
    void recordAudit({
      action: "membership.canceled",
      category: "commerce",
      outcome: "success",
      actor: { id: null, email: "stripe", role: "system" },
      target: { type: "client_membership", id: subscription.id },
      metadata: { user_id: membershipDel.user_id },
    })
    return
  }

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

// ─── Card-on-file: store the saved card from a setup Checkout ────────────────

async function handleSaveCardCheckout(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId
  if (!userId) return
  const card = await retrieveSetupCard(session)
  if (!card) return
  await upsertDefaultPaymentMethod({
    user_id: userId,
    stripe_payment_method_id: card.paymentMethodId,
    brand: card.brand,
    last4: card.last4,
    exp_month: card.expMonth,
    exp_year: card.expYear,
    is_default: true,
  })
}

// ─── Session pack checkout ───────────────────────────────────────────────────

async function handleSessionPackCheckout(session: Stripe.Checkout.Session) {
  const pkg = await getPackageByStripeSession(session.id)
  if (!pkg) {
    // Throw (→ 500) instead of silently returning 200, so Stripe RETRIES this
    // event. Covers the race where the `completed` webhook lands before the
    // pending pack row is visible (read-replica lag). A pack that genuinely
    // never existed just retries until Stripe gives up — logged, never a silent
    // paid-but-no-credits loss.
    throw new Error(`[webhook session_pack] no pack for completed session ${session.id}`)
  }
  // Idempotency: already promoted.
  if (pkg.payment_status === "paid") return

  const stripePaymentId = await resolveSessionPaymentIntent(session)
  await activatePaidPackage(pkg, stripePaymentId)

  // Auto-renew consent is now recorded on the pack itself at creation time
  // (buildPackageInsert, from the checkout request's autoRenew field) so a
  // pre-payment link re-mint can carry it forward — see checkoutOptsFor in
  // lib/services/pack-payment-link.ts. This write is therefore a redundant
  // backstop confirming Stripe metadata and the pack agree, not the primary
  // mechanism. Written as its own call, separate from activatePaidPackage, so
  // that function's call signature — asserted verbatim by the existing
  // webhook regression tests — doesn't change. Only writes when true: the
  // pack row already defaults auto_renew to false, so there is nothing to
  // disarm here.
  if (session.metadata?.autoRenew === "true") {
    try {
      await updateClientPackage(pkg.id, { auto_renew: true })
    } catch (err) {
      console.error("[webhook] could not set auto_renew on pack:", err)
    }
  }

  // Persist the card the client just used so auto-renewal has something to
  // charge later. Gated on metadata.autoRenew === "true": attaching a Stripe
  // `customer` (done unconditionally in createPackCheckoutSession, for the
  // addressee fix) is not consent to SAVE the card. A client who left the
  // checkbox unchecked declined card-saving — storing it anyway is exactly
  // the dark pattern this design exists to avoid, and pack links are
  // shareable, so whoever opens one and pays would get their card attached
  // and promoted to the payer's default. Best-effort beyond that gate: a
  // pack must never fail to be created because the card could not be stored.
  // When checkout used an explicit billToEmail (no Stripe `customer` was
  // attached — see createPackCheckoutSession), session.customer is null and
  // this whole block is a no-op, which is correct: we never save an
  // account-less payer's card against the trainee's user_id.
  //
  // I5: also gated on cardOnFileEnabled() — the spec's documented kill
  // switch for card CAPTURE, distinct from pack_auto_renew_enabled (which
  // only gates the later charge). Re-checked here rather than trusted from
  // checkout time because the flag can change in the window between
  // creating the Checkout Session and this webhook landing.
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id
  const sessionCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id
  if (piId && sessionCustomerId && session.metadata?.autoRenew === "true" && (await cardOnFileEnabled())) {
    try {
      const pi = await stripe.paymentIntents.retrieve(piId)
      const pmId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id
      if (pmId) {
        // Identity: prefer the billingUserId createPackCheckoutSession stamped
        // into metadata at checkout time. Re-resolving resolveBillingUserId
        // here instead would be a TOCTOU — the household-payer link could
        // change in the window between checkout creation and webhook
        // delivery, and resolveBillingUserId fails OPEN to self on any lookup
        // error, which would silently re-home a stranger's card. Falls back
        // to re-resolving only for sessions minted before this field existed.
        const billingUserId = session.metadata?.billingUserId || (await resolveBillingUserId(pkg.client_user_id))
        const payer = await getUserById(billingUserId)
        // Belt-and-suspenders: the Stripe customer actually attached to THIS
        // session must match what's on file for the resolved identity. A
        // mismatch means the identity resolution above landed on the wrong
        // person — skip rather than risk saving one person's card under
        // another's user_id (upsertDefaultPaymentMethod demotes ALL of the
        // target user's existing cards, so a wrong write breaks their fee
        // charging too, not just misattributes one card).
        if (payer?.stripe_customer_id === sessionCustomerId) {
          const pm = await stripe.paymentMethods.retrieve(pmId)
          await upsertDefaultPaymentMethod({
            user_id: billingUserId,
            stripe_payment_method_id: pmId,
            brand: pm.card?.brand ?? null,
            last4: pm.card?.last4 ?? null,
            exp_month: pm.card?.exp_month ?? null,
            exp_year: pm.card?.exp_year ?? null,
            is_default: true,
          })
        } else {
          console.error(
            `[webhook] pack card-save skipped: resolved billingUserId ${billingUserId} (stripe_customer_id=${payer?.stripe_customer_id ?? "none"}) does not match session.customer ${sessionCustomerId}`,
          )
        }
      }
    } catch (err) {
      console.error("[webhook] could not save pack card:", err)
    }
  }

  // Record the payment for revenue tracking (idempotent).
  if (stripePaymentId) {
    const existing = await getPaymentByStripeId(stripePaymentId)
    if (!existing) {
      const tracking = await resolveTrackingParams(session.metadata ?? {}, session.customer_details?.email)
      await createPayment({
        user_id: pkg.client_user_id,
        stripe_payment_id: stripePaymentId,
        stripe_customer_id: (session.customer as string) ?? null,
        amount_cents: session.amount_total ?? pkg.price_cents,
        currency: session.currency ?? "usd",
        status: "succeeded",
        description: "Session pack",
        metadata: { type: "session_pack", client_package_id: pkg.id },
        ...tracking,
      })
    }
  }

  void recordAudit({
    action: "pack.sold",
    category: "commerce",
    outcome: "success",
    actor: { id: null, email: "stripe", role: "system" },
    target: { type: "client_package", id: pkg.id },
    metadata: {
      client_user_id: pkg.client_user_id,
      credits: pkg.credits_total,
      price_cents: pkg.price_cents,
      payment_method: "stripe",
    },
  })
}

async function handleSessionPackExpired(session: Stripe.Checkout.Session) {
  // Stripe Checkout sessions expire ~24h after creation. Reap an abandoned,
  // never-paid pack so it can't linger as a usable freebie — but only if the
  // client hasn't already trained on it (credits_used > 0), in which case we
  // leave it active so the coach can see it and chase payment.
  const pkg = await getPackageByStripeSession(session.id)
  if (!pkg || pkg.payment_status === "paid") return
  if (pkg.credits_used > 0) return
  await updateClientPackage(pkg.id, { status: "cancelled" })
}

async function handleSessionPackRefund(stripePaymentId: string) {
  const pkg = await getPackageByStripePaymentId(stripePaymentId)
  if (!pkg || pkg.status === "refunded") return
  await updateClientPackage(pkg.id, { status: "refunded", payment_status: "refunded" })
  void recordAudit({
    action: "pack.refunded",
    category: "commerce",
    outcome: "success",
    actor: { id: null, email: "stripe", role: "system" },
    target: { type: "client_package", id: pkg.id },
    metadata: { client_user_id: pkg.client_user_id },
  })
}

// ─── Event signup checkout ────────────────────────────────────────────────────

async function recordEventSignupPayment(
  session: Stripe.Checkout.Session,
  signupId: string,
  signup: { user_id: string | null; parent_email: string; athlete_name: string } | null,
  status: "succeeded" | "refunded",
) {
  const stripePaymentId = typeof session.payment_intent === "string" ? session.payment_intent : null
  const amount = session.amount_total ?? 0
  if (!stripePaymentId || amount <= 0) return

  const existing = await getPaymentByStripeId(stripePaymentId)
  if (existing) return

  const customerEmail = session.customer_details?.email ?? signup?.parent_email ?? null
  const tracking = await resolveTrackingParams(session.metadata ?? {}, customerEmail)
  const resolvedUserId =
    signup?.user_id ?? (customerEmail ? await tryResolveUserIdFromEmail(customerEmail) : null)

  await createPayment({
    user_id: resolvedUserId,
    stripe_payment_id: stripePaymentId,
    stripe_customer_id: (session.customer as string) ?? null,
    amount_cents: amount,
    currency: session.currency ?? "usd",
    status,
    description: "Event signup",
    metadata: {
      type: "event_signup",
      event_id: session.metadata?.event_id ?? null,
      event_signup_id: signupId,
      parent_email: signup?.parent_email ?? null,
      athlete_name: signup?.athlete_name ?? null,
    },
    ...tracking,
  })
}

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

  // Record the payment so event revenue surfaces on /admin/dashboard
  // (totalRevenue, revenue trend, monthly chart, activity feed). Without this
  // the payments table only sees program/coaching/shop checkouts.
  try {
    await recordEventSignupPayment(session, signupId, updated, "succeeded")
  } catch (err) {
    console.error(`[webhook event_signup] payment record failed for signup ${signupId}`, err)
  }

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

  // Record the payment as refunded so the dashboard still has accurate history
  // (the customer was charged then immediately refunded — net zero revenue).
  // Done before the email so a slow Resend call can't mask the data write.
  try {
    await recordEventSignupPayment(session, signupId, signup, "refunded")
  } catch (err) {
    console.error(`[webhook event_signup overbook] payment record failed for ${signupId}`, err)
  }

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

// ─── Anonymous funnel purchase ──────────────────────────────────────────────
//
// The buyer had no account when they paid. Everything that turns the payment
// into working access lives in `lib/funnels/checkout/grant.ts`, which takes its
// dependencies as arguments so the order of operations can be tested for real;
// this function is the seam between Stripe's payload and those arguments.
//
// FLAG-GATED HERE AS WELL AS ON THE ROUTE. New Stripe-webhook logic must be
// flag-gated and resilient to a missing table regardless of what created the
// session — a session made while the flag was on can arrive (or be retried for
// days) after it has been turned off, and the answer then is to do nothing
// rather than to half-run a path the owner has switched off.

async function handleFunnelPurchaseCheckout(session: Stripe.Checkout.Session) {
  if (!(await getSetting<boolean>(FUNNEL_CHECKOUT_FLAG, FUNNEL_CHECKOUT_DEFAULT))) {
    console.warn("[funnel-checkout] session received while the flag is off; ignoring", session.id)
    return
  }

  const productId = session.metadata?.productId
  const productKind = session.metadata?.productKind

  // A SESSION THIS FLOW DID NOT CREATE IS IGNORED, NEVER GUESSED AT. Metadata
  // is attacker-visible and hand-editable in the Stripe dashboard; inventing a
  // product from a half-filled payload would be granting on a shape nobody
  // designed.
  if (productKind !== "program" || !productId) {
    console.error("[funnel-checkout] unusable metadata; ignoring", session.id, session.metadata)
    return
  }

  // Stripe collects the email itself, but we PIN `customer_email` when creating
  // the session, so these agree. Falling back through both is defensive: with
  // no email there is no account to find or create, and granting to nobody is
  // worse than refusing loudly.
  const email = session.customer_details?.email ?? session.customer_email ?? null
  if (!email) {
    console.error("[funnel-checkout] no buyer email on the session; ignoring", session.id)
    return
  }

  // IMPORTED LAZILY, AND NOT AS A MICRO-OPTIMISATION. `buildGrantDeps` reaches
  // `assign-program`, the 2800-line email module, the password-reset tokens DAL
  // and Supabase; imported at the top of this file, every one of the ten event
  // types this webhook handles would pay for that graph on every delivery.
  // Measured as a real cost, not a guess: adding those imports pushed several
  // unrelated Stripe webhook tests past their 5s timeout purely on load.
  const [{ grantFunnelPurchase }, { buildGrantDeps }] = await Promise.all([
    import("@/lib/funnels/checkout/grant"),
    import("@/lib/funnels/checkout/deps"),
  ])

  const leadId = session.metadata?.leadId || null
  const result = await grantFunnelPurchase(
    {
      sessionId: session.id,
      email,
      name: session.customer_details?.name ?? null,
      productKind: "program",
      productId,
      leadId,
    },
    buildGrantDeps({
      funnelId: session.metadata?.funnelId ?? null,
      stepId: session.metadata?.stepId ?? null,
      leadId,
    }),
  )

  // THE PAYMENT ROW IS WRITTEN WHATEVER HAPPENED TO THE GRANT. The money moved;
  // a failed grant is a delivery problem, and leaving the payment unrecorded
  // would hide real revenue and make the alert impossible to reconcile against
  // Stripe. `getPaymentByStripeId` keeps a webhook retry from double-counting.
  const paymentIntentId = (session.payment_intent as string) ?? null
  if (paymentIntentId) {
    const existingPayment = await getPaymentByStripeId(paymentIntentId)
    if (!existingPayment) {
      const tracking = await resolveTrackingParams(session.metadata ?? {}, email)
      await createPayment({
        user_id: result.ok && result.userId !== "" ? result.userId : null,
        stripe_payment_id: paymentIntentId,
        stripe_customer_id: (session.customer as string) ?? null,
        amount_cents: session.amount_total ?? 0,
        currency: session.currency ?? "usd",
        status: "succeeded",
        description: "Funnel purchase",
        metadata: {
          source: "funnel",
          sessionId: session.id,
          productKind,
          productId,
          funnelId: session.metadata?.funnelId ?? null,
          stepId: session.metadata?.stepId ?? null,
          customerEmail: email,
          granted: result.ok,
        },
        ...tracking,
      })
    }
  }

  // `grantFunnelPurchase` never throws — a throw inside a webhook is a retry
  // storm — and it has already alerted a human on every failing stage. Throwing
  // HERE would ask Stripe to retry, which is the right thing: the grant is
  // written to be replay-safe, and a transient database failure should get
  // another attempt rather than one email and silence.
  if (!result.ok) {
    throw new Error(`[funnel-checkout] grant failed at ${result.stage}: ${result.error}`)
  }
}
