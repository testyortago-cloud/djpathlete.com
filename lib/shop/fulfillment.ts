import { stripe } from "@/lib/stripe"
import {
  createOrder as createPrintfulOrder,
  confirmOrder as confirmPrintfulOrder,
  cancelOrder as cancelPrintfulOrder,
  type PrintfulRecipient,
} from "@/lib/printful"
import { getOrderById, updateOrder, updateOrderStatus } from "@/lib/db/shop-orders"
import { sendOrderCanceledEmail, sendOrderRefundedEmail } from "@/lib/shop/emails"
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
  if (order.status !== "paid" && order.status !== "draft") {
    throw new Error(`Cannot confirm order in status ${order.status}`)
  }

  let printfulOrderId: number

  if (order.status === "paid") {
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

    printfulOrderId = draft.id
  } else {
    // status === "draft" — Printful draft already created, retry the confirm step
    if (!order.printful_order_id) {
      throw new Error(
        `Order ${order.id} is in draft status but has no printful_order_id — cannot retry confirm`,
      )
    }
    printfulOrderId = order.printful_order_id
  }

  await confirmPrintfulOrder(printfulOrderId)
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
    try {
      await stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id })
    } catch (err) {
      console.error(
        `[cancel] Stripe refund failed for order ${order.id} (printful_order_id=${order.printful_order_id ?? "none"}, stripe_payment_intent=${order.stripe_payment_intent_id}). ` +
        `Printful cancel already ${order.printful_order_id ? "attempted" : "skipped"}. Manual Stripe refund required.`,
        err,
      )
      const note =
        `${order.notes ?? ""}\n[cancel] Stripe refund FAILED at ${new Date().toISOString()} — manual refund required for payment_intent ${order.stripe_payment_intent_id}`.trim()
      await updateOrderStatus(order.id, "canceled", { notes: note })
      throw err
    }
  }

  const updated = await updateOrderStatus(order.id, "canceled", { refund_amount_cents: order.total_cents })
  await sendOrderCanceledEmail(updated)
  return updated
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
  let updated: ShopOrder
  if (isFull) {
    updated = await updateOrderStatus(order.id, "refunded", { refund_amount_cents: amountCents, notes: notes ?? undefined })
  } else {
    updated = await updateOrder(order.id, {
      refund_amount_cents: (order.refund_amount_cents ?? 0) + amountCents,
      notes: notes ?? undefined,
    })
  }
  await sendOrderRefundedEmail(updated)
  return updated
}
