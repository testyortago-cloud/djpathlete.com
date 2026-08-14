// Automatic pack renewal. REAL MONEY — every path is guarded so a charge only
// fires when pack_auto_renew_enabled AND the pack is armed AND depleted AND
// priced AND the payer has a saved card. The unique (source_package_id) index
// plus a pack-stable Stripe idempotency key make double-charging impossible
// for the CHARGE call itself — see the "error" branch below for the related
// hazard of a second, UNPROTECTED payment channel (a fresh Checkout Session).
//
// Sibling of lib/services/session-fees.ts — read that first; the shape is
// deliberately the same so a reader of one can read the other.
import type { ClientPackage, PackRenewalAttempt } from "@/types/database"
import { packAutoRenewEnabled } from "@/lib/packs/flags"
import { shouldAttemptRenewal, buildRenewalPack } from "@/lib/services/pack-renewal-rules"
import { createRenewalAttemptIfAbsent, updateRenewalAttempt } from "@/lib/db/pack-renewal-attempts"
import { createClientPackage, updateClientPackage } from "@/lib/db/client-packages"
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
 *  the client exactly where today's manual flow does.
 *
 *  ONLY safe to call for a KNOWN-FINAL outcome (no card / a genuine decline).
 *  Never call this for an "error" (unknown charge outcome) — see the caller. */
async function fallbackToPaymentLink(
  source: ClientPackage,
  now: Date,
  payer: { email: string; first_name: string | null } | null,
  trainee: { email: string } | null,
  clientName: string,
): Promise<string | undefined> {
  const pending = await createClientPackage(buildRenewalPack(source, { paid: false, now }))
  try {
    const link = await resolvePackPaymentLink(pending)
    // Addressee precedence matches createPackCheckoutSession's own resolution
    // (explicit bill_to_email override -> household payer -> the client
    // themself) — see lib/stripe.ts's checkoutOptsFor callers — because
    // resolvePackPaymentLink pins Stripe's customer_email to source.bill_to_email
    // (carried forward unchanged by buildRenewalPack). Emailing the link to
    // anyone else means the inbox that gets it doesn't match the address
    // Checkout is locked to: the wrong-inbox bug this project already shipped a
    // fix for once. The trainee is always CC'd (dropped automatically when it
    // would duplicate `to`) so they can see what was sent on their behalf.
    const to = source.bill_to_email ?? payer?.email ?? trainee?.email ?? null
    if (link.ok && to) {
      await sendPackPaymentLinkEmail({
        to,
        ccClientEmail: trainee?.email ?? null,
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

/** M8: a DB failure here must never be fatal. This call always sits between
 *  "we know the outcome" and "we told someone about it" (the payment-link
 *  email or the admin alert) — updateRenewalAttempt uses `.single()`, which
 *  throws on any write failure, and an uncaught throw here would stop that
 *  email/alert from ever firing, stranding the attempt at `pending` with
 *  nobody notified. */
async function updateAttemptBestEffort(id: string, patch: Partial<PackRenewalAttempt>): Promise<void> {
  try {
    await updateRenewalAttempt(id, patch)
  } catch (err) {
    console.error("[pack-renewal] non-fatal: could not update renewal attempt", id, patch, err)
  }
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

  // Stamp the source pack so `renewal_attempted_at` reflects reality as soon as
  // a real attempt is reserved — read paths (reminders, admin views) can see a
  // renewal was tried even before it resolves. Best-effort: a failure here must
  // never block the charge below.
  await updateClientPackage(pkg.id, { renewal_attempted_at: now.toISOString() }).catch((err) => {
    console.error("[pack-renewal] failed to stamp renewal_attempted_at:", err)
  })

  const [payer, trainee, card] = await Promise.all([
    getUserById(billingUserId).catch(() => null),
    getUserById(pkg.client_user_id).catch(() => null),
    getDefaultPaymentMethod(billingUserId).catch(() => null),
  ])
  const clientName =
    `${trainee?.first_name ?? ""} ${trainee?.last_name ?? ""}`.trim() || "your athlete"

  if (!payer?.stripe_customer_id || !card) {
    await updateAttemptBestEffort(attempt.id, { status: "skipped", failure_reason: "no_card" })
    const newPackageId = await fallbackToPaymentLink(pkg, now, payer, trainee, clientName)
    if (newPackageId) await updateAttemptBestEffort(attempt.id, { new_package_id: newPackageId })
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
    await updateAttemptBestEffort(attempt.id, { status: "failed", failure_reason: result.message })
    void recordAudit({
      action: "pack.auto_renew_failed",
      category: "commerce",
      outcome: "failure",
      target: { type: "client_package", id: pkg.id, label: pkg.session_type },
      metadata: { reason: result.reason, amount_cents: pkg.price_cents, client_user_id: pkg.client_user_id },
    })

    if (result.reason === "error") {
      // UNKNOWN OUTCOME — deliberately does LESS than the "declined" branch
      // below. chargeSavedCard returns "error" for a network timeout or a
      // Stripe 5xx, which means we do NOT know whether the PaymentIntent
      // actually went through — the card may already have been charged.
      // Minting a fallback pack + Checkout Session here would be unsafe: that
      // session is a SECOND payment channel that lives OUTSIDE the
      // pack_renew_${pkg.id} idempotency key (Stripe idempotency only covers
      // the paymentIntents.create call we already made). If the first charge
      // silently succeeded, paying that link charges the card again — money
      // taken twice, still no resolution, and this attempt is now permanently
      // `failed` (the unique source_package_id index means it can never be
      // auto-retried). This mirrors the "pending is not safe to retry" hazard
      // retryFeeCharge documents in session-fees.ts:154-161; here the
      // equivalent rule is "create nothing new until a human reconciles
      // against Stripe."
      await notifyAdmins(
        "Pack renewal charge status unknown — reconcile before acting",
        `${clientName}'s renewal charge hit an error (${result.message}) — Stripe's outcome is unknown, the card may already have been charged. Check Stripe (idempotency key pack_renew_${pkg.id}) before charging again or sending a payment link.`,
      )
      return { renewed: false, reason: result.reason }
    }

    // "declined" is a known, final outcome — safe to fall back to today's manual flow.
    const newPackageId = await fallbackToPaymentLink(pkg, now, payer, trainee, clientName)
    if (newPackageId) await updateAttemptBestEffort(attempt.id, { new_package_id: newPackageId })
    await notifyAdmins(
      "Pack renewal charge failed",
      `${clientName}'s card was declined — a payment link was sent instead.`,
    )
    return { renewed: false, reason: result.reason, newPackageId }
  }

  // The charge just succeeded — everything from here on must not lose that
  // fact. createClientPackage + updateRenewalAttempt are wrapped together: if
  // either throws, the client has been charged with no record of why, and
  // (since source_package_id is unique) this attempt can never be
  // auto-retried. That combination — real money, silent hole, no retry path —
  // is the one outcome worse than a normal decline, so it gets its own recovery
  // branch instead of propagating.
  //
  // `createdId` (separate from `created` below) is what lets the catch block
  // tell the two failure shapes apart: if createClientPackage already
  // succeeded, a real paid pack EXISTS, and the recovery message must say so
  // — telling an admin to "create the pack manually" when one already exists
  // is how a client ends up double-credited.
  let createdId: string | null = null
  let created: ClientPackage
  try {
    created = await createClientPackage({
      ...buildRenewalPack(pkg, { paid: true, now }),
      // I1: stamp THIS charge's PaymentIntent id onto the new pack. This is
      // safe (unlike the SOURCE pack's ids, which buildRenewalPack correctly
      // leaves uncopied — see its doc comment) because it is a brand-new id
      // that has never labeled any other pack. Without it,
      // getPackageByStripePaymentId can never find this pack, so
      // handleSessionPackRefund has nothing to match a Stripe refund
      // against: the payments row would flip to refunded while this pack
      // stays paid/active with a full set of credits.
      stripe_payment_id: result.paymentIntentId,
    })
    createdId = created.id
    await updateRenewalAttempt(attempt.id, {
      status: "succeeded",
      stripe_payment_intent_id: result.paymentIntentId,
      new_package_id: created.id,
    })
  } catch (err) {
    console.error("[pack-renewal] post-charge write failed after a successful charge:", err)
    // No "half-done" status exists in PackRenewalStatus. Landing on `failed` is
    // deliberate: it stops the reminder/renewal scanners from touching this pack
    // again, while the PaymentIntent id + failure_reason on the row (and in the
    // admin alert) make clear this is NOT an ordinary decline — a human must
    // reconcile the successful charge, not tell the client their card failed.
    try {
      await updateRenewalAttempt(attempt.id, {
        status: "failed",
        stripe_payment_intent_id: result.paymentIntentId,
        new_package_id: createdId,
        failure_reason: `post_charge_write_failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    } catch (updateErr) {
      console.error("[pack-renewal] could not even flag the attempt — manual DB check required:", updateErr)
    }
    void recordAudit({
      action: "pack.auto_renew_failed",
      category: "commerce",
      outcome: "failure",
      target: { type: "client_package", id: pkg.id, label: pkg.session_type },
      metadata: {
        reason: "post_charge_write_failed",
        stripe_payment_intent_id: result.paymentIntentId,
        new_package_id: createdId,
        amount_cents: pkg.price_cents,
        client_user_id: pkg.client_user_id,
      },
    })
    // Two very different situations, and telling them apart is the difference
    // between an admin fixing this and an admin double-crediting the client.
    const adminMessage = createdId
      ? `${clientName}'s card was charged (PaymentIntent ${result.paymentIntentId}) and pack ${createdId} WAS created, but the renewal record could not be updated. Do NOT create another pack — reconcile the attempt row against pack ${createdId}.`
      : `${clientName}'s card was charged (PaymentIntent ${result.paymentIntentId}) but creating the renewed pack failed. Create and credit the pack manually.`
    await notifyAdmins("Pack renewal charged but did not complete — needs manual fix", adminMessage)
    return { renewed: false, reason: "post_charge_write_failed" }
  }

  try {
    await createPayment({
      // C1: matches the manual pack-checkout mirror's convention (webhook
      // route.ts's handleSessionPackCheckout — `user_id: pkg.client_user_id`)
      // — the trainee, not whoever's card was actually charged. Which
      // Stripe customer paid is still recorded below via stripe_customer_id.
      user_id: pkg.client_user_id,
      stripe_payment_id: result.paymentIntentId,
      stripe_customer_id: payer.stripe_customer_id,
      amount_cents: pkg.price_cents,
      currency: "usd",
      status: "succeeded",
      description: label,
      // C1 (was double-booking every renewal as revenue): income-adapter
      // only recognizes metadata.type "session_pack"/"event_signup" as a
      // mirror row of an existing client_packages/event_signups sale — any
      // other type (the old "pack_auto_renewal") falls through to its
      // generic non-mirror path and becomes a SECOND income draft on top of
      // the one the renewal's own (paid) client_packages row already
      // produces. client_package_id must be the NEW pack's id (created.id,
      // not the depleted source pack) — that's the row income-adapter's
      // id-pairing branch looks up by `sourceId` to consume and stamp
      // alt_ref on. auto_renewal: true keeps this distinguishable from a
      // manual sale for anyone reading the metadata directly.
      metadata: {
        type: "session_pack",
        client_package_id: created.id,
        auto_renewal: true,
        source_package_id: pkg.id,
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
