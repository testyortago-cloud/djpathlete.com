import Stripe from "stripe"
import type { Program } from "@/types/database"

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function createCheckoutSession(
  program: Program,
  userId: string,
  returnUrl?: string
) {
  const successUrl = `${process.env.NEXT_PUBLIC_APP_URL}${returnUrl ?? "/programs/success"}?session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${process.env.NEXT_PUBLIC_APP_URL}/programs/${program.id}`

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
