// No-show / late-cancel fee charging. REAL MONEY — every path is guarded so a
// charge only ever fires when session_fees_enabled AND the configured amount > 0
// AND the client has a saved default card. The unique (session, kind) DB index
// + a per-charge Stripe idempotency key make double-charging impossible.
import type { ScheduledSession, SessionFeeKind } from "@/types/database"
import {
  sessionFeesEnabled,
  sessionFeePayerNotifyEnabled,
  noShowFeeCents,
  lateCancelFeeCents,
  cancelWindowHours,
} from "@/lib/packs/flags"
import { getUserById } from "@/lib/db/users"
import { getDefaultPaymentMethod } from "@/lib/db/payment-methods"
import { chargeSavedCard } from "@/lib/stripe"
import { createFeeChargeIfAbsent, updateFeeCharge, getFeeChargeById } from "@/lib/db/session-fee-charges"
import { createPayment } from "@/lib/db/payments"
import { recordAudit } from "@/lib/audit/record"
import { resolveBillingUserId } from "@/lib/services/billing-payer"
import { sendFeeChargedToPayerEmail } from "@/lib/email"

type FeeOutcome = { charged: boolean; reason?: string }

/**
 * Fire-and-forget courtesy email to a household payer whose card just covered
 * someone ELSE's fee. Fully swallowed — a notification failure must never
 * affect the money path. No-ops for self-payers.
 */
async function notifyPayerCharged(opts: {
  payer: { id: string; email: string; first_name: string | null }
  traineeUserId: string
  kind: SessionFeeKind
  amountCents: number
  sessionDate?: string
}): Promise<void> {
  try {
    if (opts.payer.id === opts.traineeUserId) return
    if (!(await sessionFeePayerNotifyEnabled())) return
    const trainee = await getUserById(opts.traineeUserId).catch(() => null)
    const traineeName = trainee
      ? `${trainee.first_name ?? ""} ${trainee.last_name ?? ""}`.trim() || trainee.email
      : "a member of your household"
    await sendFeeChargedToPayerEmail({
      to: opts.payer.email,
      firstName: opts.payer.first_name ?? "there",
      traineeName,
      kind: opts.kind,
      amountCents: opts.amountCents,
      sessionDate: opts.sessionDate,
    })
  } catch (err) {
    console.error("[session-fees] payer charge notification failed:", err)
  }
}

async function attemptFee(session: ScheduledSession, kind: SessionFeeKind, amountCents: number): Promise<FeeOutcome> {
  if (amountCents <= 0) return { charged: false, reason: "no_fee" }

  // Reserve the charge first (idempotent). A null result means a charge of this
  // kind already exists for the session → never charge twice.
  const charge = await createFeeChargeIfAbsent({
    scheduled_session_id: session.id,
    user_id: session.client_user_id,
    kind,
    amount_cents: amountCents,
    status: "pending",
    stripe_payment_intent_id: null,
    failure_reason: null,
  })
  if (!charge) return { charged: false, reason: "already_charged" }

  // Household billing: the charge records against the trainee (whose session it
  // was), but the money comes from the resolved billing user's card (a payer, or
  // themselves when none is set).
  const billingUserId = await resolveBillingUserId(session.client_user_id)
  const [user, card] = await Promise.all([
    getUserById(billingUserId).catch(() => null),
    getDefaultPaymentMethod(billingUserId).catch(() => null),
  ])
  if (!user?.stripe_customer_id || !card) {
    await updateFeeCharge(charge.id, { status: "waived", failure_reason: "no_card" })
    return { charged: false, reason: "no_card" }
  }

  const label = kind === "no_show" ? "No-show fee" : "Late-cancellation fee"
  const result = await chargeSavedCard({
    customerId: user.stripe_customer_id,
    paymentMethodId: card.stripe_payment_method_id,
    amountCents,
    description: label,
    idempotencyKey: `fee_${session.id}_${kind}`,
  })

  if (result.ok) {
    await updateFeeCharge(charge.id, { status: "succeeded", stripe_payment_intent_id: result.paymentIntentId })
    await createPayment({
      user_id: billingUserId, // the card owner who actually paid
      stripe_payment_id: result.paymentIntentId,
      stripe_customer_id: user.stripe_customer_id,
      amount_cents: amountCents,
      currency: "usd",
      status: "succeeded",
      description: label,
      metadata: { type: "session_fee", kind, scheduled_session_id: session.id, trainee_user_id: session.client_user_id },
      gclid: null,
      gbraid: null,
      wbraid: null,
      fbclid: null,
    }).catch(() => {})
    void recordAudit({
      action: "session.fee_charged",
      category: "commerce",
      outcome: "success",
      target: { type: "session_fee_charge", id: charge.id },
      metadata: { kind, amount_cents: amountCents, user_id: session.client_user_id },
    })
    void notifyPayerCharged({
      payer: { id: billingUserId, email: user.email, first_name: user.first_name },
      traineeUserId: session.client_user_id,
      kind,
      amountCents,
      sessionDate: session.session_date,
    })
    return { charged: true }
  }

  await updateFeeCharge(charge.id, { status: "failed", failure_reason: result.message })
  void recordAudit({
    action: "session.fee_failed",
    category: "commerce",
    outcome: "failure",
    target: { type: "session_fee_charge", id: charge.id },
    metadata: { kind, reason: result.reason, user_id: session.client_user_id },
  })
  return { charged: false, reason: result.reason }
}

/** Charge the configured no-show fee (best-effort). No-op unless enabled + amount>0 + card. */
export async function chargeNoShowFee(session: ScheduledSession): Promise<FeeOutcome> {
  if (!(await sessionFeesEnabled())) return { charged: false, reason: "disabled" }
  return attemptFee(session, "no_show", await noShowFeeCents())
}

/** Charge the late-cancel fee only when cancelled INSIDE the configured window. */
export async function chargeLateCancelFee(session: ScheduledSession, now: Date): Promise<FeeOutcome> {
  if (!(await sessionFeesEnabled())) return { charged: false, reason: "disabled" }
  const windowHours = await cancelWindowHours()
  const start = new Date(`${session.session_date}T${session.start_time}Z`).getTime()
  const hoursUntil = (start - now.getTime()) / 3_600_000
  if (hoursUntil > windowHours) return { charged: false, reason: "outside_window" } // cancelled early enough
  return attemptFee(session, "late_cancel", await lateCancelFeeCents())
}

/**
 * Re-attempt a fee charge (admin action). Only retries a `failed` charge — never
 * a `pending` one, whose Stripe outcome is unknown (a network error may have
 * charged the card). Reuses the SESSION-STABLE idempotency key so a retry inside
 * Stripe's idempotency window returns the original PaymentIntent instead of
 * double-charging; the trade-off is that a same-window retry after a genuine
 * decline replays the decline (waive + re-trigger for a truly new attempt).
 */
export async function retryFeeCharge(chargeId: string): Promise<FeeOutcome> {
  if (!(await sessionFeesEnabled())) return { charged: false, reason: "disabled" }
  const charge = await getFeeChargeById(chargeId)
  if (!charge || charge.status !== "failed") return { charged: false, reason: "not_retryable" }
  // Charge the same resolved billing user (payer or self) as the original attempt.
  const billingUserId = await resolveBillingUserId(charge.user_id)
  const [user, card] = await Promise.all([
    getUserById(billingUserId).catch(() => null),
    getDefaultPaymentMethod(billingUserId).catch(() => null),
  ])
  if (!user?.stripe_customer_id || !card) {
    await updateFeeCharge(charge.id, { status: "waived", failure_reason: "no_card" })
    return { charged: false, reason: "no_card" }
  }
  const result = await chargeSavedCard({
    customerId: user.stripe_customer_id,
    paymentMethodId: card.stripe_payment_method_id,
    amountCents: charge.amount_cents,
    description: `${charge.kind === "no_show" ? "No-show" : "Late-cancellation"} fee (retry)`,
    idempotencyKey: `fee_${charge.scheduled_session_id}_${charge.kind}`,
  })
  if (result.ok) {
    await updateFeeCharge(charge.id, {
      status: "succeeded",
      stripe_payment_intent_id: result.paymentIntentId,
      failure_reason: null,
    })
    void notifyPayerCharged({
      payer: { id: billingUserId, email: user.email, first_name: user.first_name },
      traineeUserId: charge.user_id,
      kind: charge.kind,
      amountCents: charge.amount_cents,
    })
    return { charged: true }
  }
  await updateFeeCharge(charge.id, { status: "failed", failure_reason: result.message })
  return { charged: false, reason: result.reason }
}
