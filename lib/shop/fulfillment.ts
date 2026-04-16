import { stripe } from "@/lib/stripe"
import {
  createOrder as createPrintfulOrder,
  confirmOrder as confirmPrintfulOrder,
  cancelOrder as cancelPrintfulOrder,
  type PrintfulRecipient,
} from "@/lib/printful"
import { getOrderById, updateOrder, updateOrderStatus } from "@/lib/db/shop-orders"
import type { ShopOrder } from "@/types/database"

function addressToRecipient(order: ShopOrder): PrintfulRecipient {
  const a = order.shipping_address
  return {
    name: a.name,
    email: a.email,
    phone: a.phone,
    address1: a.line1,
    address2: a.line2,
    city: a.city,
    state_code: a.state,
    country_code: a.country,
    zip: a.postal_code,
  }
}

export async function confirmOrderToPrintful(orderId: string): Promise<ShopOrder> {
  const order = await getOrderById(orderId)
  if (!order) throw new Error("Order not found")
  if (order.status !== "paid") throw new Error(`Cannot confirm order in status ${order.status}`)

  const items = order.items.map((i) => ({
    sync_variant_id: undefined as number | undefined,
    variant_id: i.printful_variant_id,
    quantity: i.quantity,
    retail_price: (i.unit_price_cents / 100).toFixed(2),
  }))

  const draft = await createPrintfulOrder({
    external_id: order.order_number,
    recipient: addressToRecipient(order),
    items,
  })

  await updateOrder(order.id, {
    status: "draft",
    printful_order_id: draft.id,
  })

  await confirmPrintfulOrder(draft.id)
  return updateOrderStatus(order.id, "confirmed")
}

export async function cancelShopOrder(orderId: string): Promise<ShopOrder> {
  const order = await getOrderById(orderId)
  if (!order) throw new Error("Order not found")
  if (order.status !== "paid" && order.status !== "draft") {
    throw new Error(`Cannot cancel order in status ${order.status}`)
  }

  if (order.printful_order_id) {
    try {
      await cancelPrintfulOrder(order.printful_order_id)
    } catch (err) {
      console.error("[cancel] Printful cancel failed", err)
    }
  }

  if (order.stripe_payment_intent_id) {
    await stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id })
  }

  return updateOrderStatus(order.id, "canceled", { refund_amount_cents: order.total_cents })
}

export async function refundShopOrder(
  orderId: string,
  amountCents: number,
  reason?: string,
): Promise<ShopOrder> {
  const order = await getOrderById(orderId)
  if (!order) throw new Error("Order not found")
  if (!order.stripe_payment_intent_id) throw new Error("No Stripe payment intent")
  if (amountCents > order.total_cents) throw new Error("Refund exceeds total")

  await stripe.refunds.create({
    payment_intent: order.stripe_payment_intent_id,
    amount: amountCents,
    reason: reason ? "requested_by_customer" : undefined,
  })

  const isFull = amountCents >= order.total_cents
  const notes = reason ? `${order.notes ?? ""}\n[refund] ${reason}`.trim() : order.notes
  if (isFull) {
    return updateOrderStatus(order.id, "refunded", { refund_amount_cents: amountCents, notes: notes ?? undefined })
  }
  return updateOrder(order.id, {
    refund_amount_cents: (order.refund_amount_cents ?? 0) + amountCents,
    notes: notes ?? undefined,
  })
}
