/**
 * Backfill external Stripe payments and subscriptions into Supabase.
 *
 * Pulls Stripe Checkout Sessions created between BACKFILL_FROM and now,
 * and inserts any that aren't already present in the payments /
 * subscriptions tables. Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/backfill-stripe-payments.ts
 *
 * Env required (loaded from .env.local):
 *   STRIPE_SECRET_KEY
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as dotenv from "dotenv"
import { expand } from "dotenv-expand"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

expand(dotenv.config({ path: resolve(__dirname, "../.env.local") }))

const BACKFILL_FROM = new Date("2026-03-22T00:00:00.000Z")

// ─── Clients ──────────────────────────────────────────────────────────────────

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ─── Types ────────────────────────────────────────────────────────────────────

interface Counters {
  paymentsInserted: number
  paymentsSkipped: number
  subscriptionsInserted: number
  subscriptionsSkipped: number
  errors: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveSessionPaymentIntent(session: Stripe.Checkout.Session): Promise<string | null> {
  if (session.payment_intent) {
    return typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent.id
  }
  if (session.mode === "subscription" && session.subscription) {
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id
    try {
      const sub = await stripe.subscriptions.retrieve(subId, {
        expand: ["latest_invoice.payments", "latest_invoice.payment_intent"],
      })
      const invoice = sub.latest_invoice
      if (invoice && typeof invoice !== "string") {
        // Stripe's newer invoice shape nests the PI under invoice.payments.data[0].payment.payment_intent.
        // Older shape exposes it as invoice.payment_intent. Check both.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inv = invoice as any
        const nested =
          inv.payments?.data?.[0]?.payment?.payment_intent ??
          inv.payments?.data?.[0]?.payment_intent
        if (nested) return typeof nested === "string" ? nested : nested.id
        const legacy = inv.payment_intent
        if (legacy) return typeof legacy === "string" ? legacy : legacy.id
      }
    } catch {
      return null
    }
  }
  return null
}

async function tryResolveUserIdFromEmail(email: string | null | undefined): Promise<string | null> {
  if (!email) return null
  try {
    const { data } = await supabase.from("users").select("id").eq("email", email).maybeSingle()
    return data?.id ?? null
  } catch {
    return null
  }
}

async function getPaymentByStripeId(stripePaymentId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("payments")
    .select("id")
    .eq("stripe_payment_id", stripePaymentId)
    .maybeSingle()
  if (error) throw error
  return data !== null
}

async function getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle()
  if (error) throw error
  return data !== null
}

// ─── Session processing ───────────────────────────────────────────────────────

async function backfillSession(session: Stripe.Checkout.Session, counters: Counters) {
  // Only "complete" sessions correspond to actual payments
  if (session.status !== "complete") return

  const customerEmail = session.customer_details?.email ?? null
  const resolvedUserId = await tryResolveUserIdFromEmail(customerEmail)

  // Subscriptions: capture the subscription record (initial payment captured below)
  if (session.mode === "subscription" && session.subscription) {
    const stripeSubscriptionId = session.subscription as string
    const exists = await getSubscriptionByStripeId(stripeSubscriptionId)
    if (exists) {
      counters.subscriptionsSkipped++
    } else {
      try {
        const { error } = await supabase.from("subscriptions").insert({
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
            customerEmail,
            backfilled: true,
          },
        })
        if (error) throw error
        counters.subscriptionsInserted++
      } catch (err) {
        console.error(`  ERROR creating subscription for session ${session.id}:`, (err as Error).message)
        counters.errors++
      }
    }
  }

  // Payments: capture the initial payment intent for both one-time and subscription sessions
  const stripePaymentId = await resolveSessionPaymentIntent(session)
  if (stripePaymentId) {
    const exists = await getPaymentByStripeId(stripePaymentId)
    if (exists) {
      counters.paymentsSkipped++
      return
    }
    try {
      const { error } = await supabase.from("payments").insert({
        user_id: resolvedUserId,
        stripe_payment_id: stripePaymentId,
        stripe_customer_id: (session.customer as string) ?? null,
        amount_cents: session.amount_total ?? 0,
        currency: session.currency ?? "usd",
        status: "succeeded",
        description:
          session.mode === "subscription"
            ? "External subscription (initial)"
            : "External Stripe checkout",
        metadata: {
          source: "external",
          sessionId: session.id,
          customerEmail,
          backfilled: true,
          ...(session.mode === "subscription" && session.subscription
            ? { subscriptionId: session.subscription as string }
            : {}),
        },
      })
      if (error) throw error
      counters.paymentsInserted++
    } catch (err) {
      console.error(`  ERROR creating payment for session ${session.id}:`, (err as Error).message)
      counters.errors++
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Backfilling external Stripe payments from ${BACKFILL_FROM.toISOString()} to now...`)

  const counters: Counters = {
    paymentsInserted: 0,
    paymentsSkipped: 0,
    subscriptionsInserted: 0,
    subscriptionsSkipped: 0,
    errors: 0,
  }

  let processed = 0
  for await (const session of stripe.checkout.sessions.list({
    created: { gte: Math.floor(BACKFILL_FROM.getTime() / 1000) },
    limit: 100,
  })) {
    processed++
    if (processed % 25 === 0) {
      console.log(`  ... processed ${processed} sessions so far`)
    }
    await backfillSession(session, counters)
  }

  console.log()
  console.log("Done.")
  console.log(`  Sessions scanned:        ${processed}`)
  console.log(`  Payments inserted:       ${counters.paymentsInserted}`)
  console.log(`  Payments skipped:        ${counters.paymentsSkipped} (already present)`)
  console.log(`  Subscriptions inserted:  ${counters.subscriptionsInserted}`)
  console.log(`  Subscriptions skipped:   ${counters.subscriptionsSkipped} (already present)`)
  console.log(`  Errors:                  ${counters.errors}`)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
