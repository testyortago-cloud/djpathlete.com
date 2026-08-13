// Automatic pack renewal. REAL MONEY — every path is guarded so a charge only
// fires when pack_auto_renew_enabled AND the pack is armed AND depleted AND
// priced AND the payer has a saved card. The unique (source_package_id) index
// plus a pack-stable Stripe idempotency key make double-charging impossible.
//
// Sibling of lib/services/session-fees.ts — read that first; the shape is
// deliberately the same so a reader of one can read the other.
import type { ClientPackage } from "@/types/database"
import { packAutoRenewEnabled } from "@/lib/packs/flags"
import { shouldAttemptRenewal, buildRenewalPack } from "@/lib/services/pack-renewal-rules"
import { createRenewalAttemptIfAbsent, updateRenewalAttempt } from "@/lib/db/pack-renewal-attempts"
import { createClientPackage } from "@/lib/db/client-packages"
import { resolveBillingUserId } from "@/lib/services/billing-payer"
import { getDefaultPaymentMethod } from "@/lib/db/payment-methods"
import { getUserById, getUsers } from "@/lib/db/users"
import { chargeSavedCard } from "@/lib/stripe"
import { createPayment } from "@/lib/db/payments"
import { recordAudit } from "@/lib/audit/record"
import { resolvePackPaymentLink } from "@/lib/services/pack-payment-link"
import { sendPackPaymentLinkEmail, sendPackRenewedEmail } from "@/lib/email"
import { createNotification } from "@/lib/db/notifications"

export type RenewalOutcome = { renewed: boolean; reason?: string; newPackageId?: string }

/** Create the replacement pack as pending and put a payment link in the payer's
 *  inbox. This is the shared fallback for "no card" and "declined" — both land
 *  the client exactly where today's manual flow does. */
async function fallbackToPaymentLink(
  source: ClientPackage,
  now: Date,
  payer: { email: string; first_name: string | null } | null,
  clientName: string,
): Promise<string | undefined> {
  const pending = await createClientPackage(buildRenewalPack(source, { paid: false, now }))
  try {
    const link = await resolvePackPaymentLink(pending)
    if (link.ok && payer?.email) {
      await sendPackPaymentLinkEmail({
        to: payer.email,
        ccClientEmail: null,
        clientName,
        packLabel: `${pending.credits_total}× ${pending.session_type}`,
        amountCents: pending.price_cents,
        url: link.url,
      })
    }
  } catch (err) {
    console.error("[pack-renewal] payment-link fallback failed:", err)
  }
  return pending.id
}

/** Best-effort in-app alert to every admin that a renewal needs a human. */
async function notifyAdmins(title: string, message: string): Promise<void> {
  try {
    const admins = (await getUsers()).filter((u) => u.role === "admin")
    for (const admin of admins) {
      await createNotification({
        user_id: admin.id,
        title,
        message,
        type: "warning",
        is_read: false,
        link: "/admin/clients",
      })
    }
  } catch (err) {
    console.error("[pack-renewal] admin notification failed:", err)
  }
}

export async function attemptPackRenewal(pkg: ClientPackage, now = new Date()): Promise<RenewalOutcome> {
  const decision = shouldAttemptRenewal(pkg, await packAutoRenewEnabled())
  if (!decision.attempt) return { renewed: false, reason: decision.reason }

  // Household billing: the money comes from the resolved payer's card, but the
  // attempt records against the trainee whose pack ran out.
  const billingUserId = await resolveBillingUserId(pkg.client_user_id)

  // Reserve first. null means another trigger already claimed this pack.
  const attempt = await createRenewalAttemptIfAbsent({
    source_package_id: pkg.id,
    new_package_id: null,
    user_id: pkg.client_user_id,
    billing_user_id: billingUserId,
    amount_cents: pkg.price_cents,
    status: "pending",
    stripe_payment_intent_id: null,
    failure_reason: null,
  })
  if (!attempt) return { renewed: false, reason: "already_attempted" }

  const [payer, trainee, card] = await Promise.all([
    getUserById(billingUserId).catch(() => null),
    getUserById(pkg.client_user_id).catch(() => null),
    getDefaultPaymentMethod(billingUserId).catch(() => null),
  ])
  const clientName =
    `${trainee?.first_name ?? ""} ${trainee?.last_name ?? ""}`.trim() || "your athlete"

  if (!payer?.stripe_customer_id || !card) {
    await updateRenewalAttempt(attempt.id, { status: "skipped", failure_reason: "no_card" })
    const newPackageId = await fallbackToPaymentLink(pkg, now, payer, clientName)
    if (newPackageId) await updateRenewalAttempt(attempt.id, { new_package_id: newPackageId })
    await notifyAdmins(
      "Pack renewal needs payment",
      `${clientName}'s pack ran out and there's no card on file — a payment link was sent instead.`,
    )
    return { renewed: false, reason: "no_card", newPackageId }
  }

  const label = `${pkg.credits_total}× ${pkg.session_type} (auto-renewal)`
  const result = await chargeSavedCard({
    customerId: payer.stripe_customer_id,
    paymentMethodId: card.stripe_payment_method_id,
    amountCents: pkg.price_cents,
    description: label,
    idempotencyKey: `pack_renew_${pkg.id}`,
  })

  if (!result.ok) {
    await updateRenewalAttempt(attempt.id, { status: "failed", failure_reason: result.message })
    const newPackageId = await fallbackToPaymentLink(pkg, now, payer, clientName)
    if (newPackageId) await updateRenewalAttempt(attempt.id, { new_package_id: newPackageId })
    void recordAudit({
      action: "pack.auto_renew_failed",
      category: "commerce",
      outcome: "failure",
      target: { type: "client_package", id: pkg.id, label: pkg.session_type },
      metadata: { reason: result.reason, amount_cents: pkg.price_cents, client_user_id: pkg.client_user_id },
    })
    await notifyAdmins(
      "Pack renewal charge failed",
      `${clientName}'s card was declined — a payment link was sent instead.`,
    )
    return { renewed: false, reason: result.reason, newPackageId }
  }

  const created = await createClientPackage(buildRenewalPack(pkg, { paid: true, now }))
  await updateRenewalAttempt(attempt.id, {
    status: "succeeded",
    stripe_payment_intent_id: result.paymentIntentId,
    new_package_id: created.id,
  })

  try {
    await createPayment({
      user_id: billingUserId,
      stripe_payment_id: result.paymentIntentId,
      stripe_customer_id: payer.stripe_customer_id,
      amount_cents: pkg.price_cents,
      currency: "usd",
      status: "succeeded",
      description: label,
      // type distinguishes this from the mirror row a manual pack checkout writes,
      // so bookkeeping can tell them apart and not double-count.
      metadata: {
        type: "pack_auto_renewal",
        source_package_id: pkg.id,
        new_package_id: created.id,
        trainee_user_id: pkg.client_user_id,
      },
      gclid: null, gbraid: null, wbraid: null, fbclid: null,
    })
  } catch (err) {
    // A payments-mirror-row failure must never undo a charge that already succeeded.
    console.error("[pack-renewal] payments mirror row failed:", err)
  }

  void recordAudit({
    action: "pack.auto_renewed",
    category: "commerce",
    outcome: "success",
    target: { type: "client_package", id: created.id, label: pkg.session_type },
    metadata: { source_package_id: pkg.id, amount_cents: pkg.price_cents, client_user_id: pkg.client_user_id },
  })

  try {
    if (payer.email) {
      await sendPackRenewedEmail({
        to: payer.email,
        ccClientEmail: trainee?.email && trainee.email !== payer.email ? trainee.email : null,
        firstName: payer.first_name ?? "there",
        clientName,
        packLabel: `${pkg.credits_total}× ${pkg.session_type}`,
        amountCents: pkg.price_cents,
      })
    }
  } catch (err) {
    // A receipt failure must never affect the money path.
    console.error("[pack-renewal] receipt email failed:", err)
  }

  return { renewed: true, newPackageId: created.id }
}
