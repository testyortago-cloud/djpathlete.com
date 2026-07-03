// No-show / late-cancel fee charging. REAL MONEY — every path is guarded so a
// charge only ever fires when session_fees_enabled AND the configured amount > 0
// AND the client has a saved default card. The unique (session, kind) DB index
// + a per-charge Stripe idempotency key make double-charging impossible.
import type { ScheduledSession, SessionFeeKind } from "@/types/database"
import { sessionFeesEnabled, noShowFeeCents, lateCancelFeeCents, cancelWindowHours } from "@/lib/packs/flags"
import { getUserById } from "@/lib/db/users"
import { getDefaultPaymentMethod } from "@/lib/db/payment-methods"
import { chargeSavedCard } from "@/lib/stripe"
import { createFeeChargeIfAbsent, updateFeeCharge } from "@/lib/db/session-fee-charges"
import { createPayment } from "@/lib/db/payments"
import { recordAudit } from "@/lib/audit/record"

type FeeOutcome = { charged: boolean; reason?: string }

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

  const [user, card] = await Promise.all([
    getUserById(session.client_user_id).catch(() => null),
    getDefaultPaymentMethod(session.client_user_id).catch(() => null),
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
      user_id: session.client_user_id,
      stripe_payment_id: result.paymentIntentId,
      stripe_customer_id: user.stripe_customer_id,
      amount_cents: amountCents,
      currency: "usd",
      status: "succeeded",
      description: label,
      metadata: { type: "session_fee", kind, scheduled_session_id: session.id },
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
