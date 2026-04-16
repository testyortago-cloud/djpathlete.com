import type Stripe from "stripe"
import { getOrderByStripeSessionId, updateOrderStatus } from "@/lib/db/shop-orders"

/**
 * Handles `checkout.session.completed` events where `metadata.type === "shop_order"`.
 *
 * Designed to be idempotent and non-throwing — webhook retries should not loop
 * on transient errors. Fatal conditions are logged instead of re-thrown.
 */
export async function handleShopOrderCheckout(session: Stripe.Checkout.Session): Promise<void> {
  if (!session.id) return

  // Look up the order by the Stripe session ID
  const order = await getOrderByStripeSessionId(session.id)
  if (!order) {
    console.error(`[webhook shop_order] No order found for stripe_session_id=${session.id}`)
    return
  }

  // Idempotency: skip if already processed
  if (order.status !== "pending") {
    return
  }

  // Extract payment_intent — Stripe can return either a string ID or an expanded object
  const paymentIntent = session.payment_intent
  const stripePaymentIntentId =
    typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id ?? null

  await updateOrderStatus(order.id, "paid", {
    ...(stripePaymentIntentId ? { stripe_payment_intent_id: stripePaymentIntentId } : {}),
  })

  // TODO (Task 24): send order-received email to customer
  // await sendOrderReceivedEmail(order)
}
