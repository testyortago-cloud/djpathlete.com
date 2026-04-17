import type Stripe from "stripe"
import { getOrderByStripeSessionId, updateOrderStatus, updateOrder } from "@/lib/db/shop-orders"
import { sendOrderReceivedEmail, sendDigitalFulfillmentEmail } from "@/lib/shop/emails"
import { listDownloadsForOrder, createOrderDownload } from "@/lib/db/shop-order-downloads"
import { listFilesForProduct } from "@/lib/db/shop-product-files"
import { getProductById } from "@/lib/db/shop-products"

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

  const updated = await updateOrderStatus(order.id, "paid", {
    ...(stripePaymentIntentId ? { stripe_payment_intent_id: stripePaymentIntentId } : {}),
  })

  await sendOrderReceivedEmail(updated)

  // ─── Digital fulfillment ─────────────────────────────────────────────────────

  const digitalItems = updated.items.filter((i) => i.product_type === "digital")

  if (digitalItems.length > 0) {
    // Idempotency: only create downloads if none exist yet
    const existingDownloads = await listDownloadsForOrder(updated.id)
    if (existingDownloads.length === 0) {
      const now = new Date()

      for (const item of digitalItems) {
        const product = await getProductById(item.product_id)
        if (!product) continue

        const files = await listFilesForProduct(product.id)
        for (const file of files) {
          const accessExpiresAt =
            product.digital_access_days != null
              ? new Date(now.getTime() + product.digital_access_days * 86400 * 1000).toISOString()
              : null

          await createOrderDownload({
            order_id: updated.id,
            product_id: product.id,
            file_id: file.id,
            access_expires_at: accessExpiresAt,
            max_downloads: product.digital_max_downloads ?? null,
          })
        }
      }

      // Send fulfillment email
      await sendDigitalFulfillmentEmail({
        to: updated.customer_email,
        orderNumber: updated.order_number,
      })
    }

    // If order is digital-only (no POD items), advance to fulfilled_digital
    const hasPodItems = updated.items.some((i) => i.product_type !== "digital")
    if (!hasPodItems) {
      await updateOrder(updated.id, { status: "fulfilled_digital" })
    }
  }
}
