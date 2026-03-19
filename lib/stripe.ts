import Stripe from "stripe"
import type { Program, PaymentType, BillingInterval } from "@/types/database"
import { updateUser, getUserById } from "@/lib/db/users"

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.NEXTAUTH_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
    ?? "https://darrenjpaul.com"
}

// ─── Existing: One-time checkout (unchanged) ─────────────────────────────────

export async function createCheckoutSession(
  program: Program,
  userId: string,
  returnUrl?: string
) {
  const baseUrl = getBaseUrl()
  const successUrl = `${baseUrl}${returnUrl ?? "/programs/success"}?session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${baseUrl}/client/programs/${program.id}`

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: program.name,
            description: program.description ?? undefined,
          },
          unit_amount: program.price_cents!,
        },
        quantity: 1,
      },
    ],
    metadata: {
      programId: program.id,
      userId,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  })

  return session
}

export function verifyWebhookSignature(body: string, signature: string) {
  return stripe.webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  )
}

// ─── New: Product & Price management ─────────────────────────────────────────

export async function createStripeProductAndPrice(opts: {
  name: string
  description: string | null
  priceCents: number
  paymentType: PaymentType
  billingInterval: BillingInterval | null
  programId: string
}) {
  const product = await stripe.products.create({
    name: opts.name,
    description: opts.description ?? undefined,
    metadata: { programId: opts.programId },
  })

  const priceData: Stripe.PriceCreateParams = {
    product: product.id,
    unit_amount: opts.priceCents,
    currency: "usd",
  }

  if (opts.paymentType === "subscription" && opts.billingInterval) {
    priceData.recurring = { interval: opts.billingInterval }
  }

  const price = await stripe.prices.create(priceData)

  return { productId: product.id, priceId: price.id }
}

export async function updateStripeProduct(
  productId: string,
  name: string,
  description: string | null
) {
  await stripe.products.update(productId, {
    name,
    description: description ?? undefined,
  })
}

export async function archiveAndCreateNewPrice(opts: {
  productId: string
  oldPriceId: string
  priceCents: number
  paymentType: PaymentType
  billingInterval: BillingInterval | null
}) {
  // Archive the old price (can't delete prices in Stripe)
  await stripe.prices.update(opts.oldPriceId, { active: false })

  const priceData: Stripe.PriceCreateParams = {
    product: opts.productId,
    unit_amount: opts.priceCents,
    currency: "usd",
  }

  if (opts.paymentType === "subscription" && opts.billingInterval) {
    priceData.recurring = { interval: opts.billingInterval }
  }

  const price = await stripe.prices.create(priceData)
  return price.id
}

// ─── New: Customer management ────────────────────────────────────────────────

export async function getOrCreateStripeCustomer(
  userId: string,
  email: string
): Promise<string> {
  const user = await getUserById(userId)

  if (user.stripe_customer_id) {
    return user.stripe_customer_id
  }

  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  })

  await updateUser(userId, { stripe_customer_id: customer.id })

  return customer.id
}

// ─── New: Subscription checkout ──────────────────────────────────────────────

export async function createSubscriptionCheckoutSession(
  program: Program,
  customerId: string,
  userId: string,
  returnUrl?: string
) {
  const baseUrl = getBaseUrl()
  const successUrl = `${baseUrl}${returnUrl ?? "/programs/success"}?session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${baseUrl}/client/programs/${program.id}`

  if (!program.stripe_price_id) {
    throw new Error("Program does not have a Stripe price configured")
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: program.stripe_price_id,
        quantity: 1,
      },
    ],
    metadata: {
      programId: program.id,
      userId,
    },
    subscription_data: {
      metadata: {
        programId: program.id,
        userId,
      },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  })

  return session
}

// ─── New: Billing portal ─────────────────────────────────────────────────────

export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string
) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })

  return session
}
