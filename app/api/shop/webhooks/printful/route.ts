import { NextResponse } from "next/server"
import { verifyWebhookSignature } from "@/lib/printful"
import {
  getOrderByPrintfulOrderId,
  updateOrderStatus,
  updateOrder,
} from "@/lib/db/shop-orders"
import { sendOrderShippedEmail } from "@/lib/shop/emails"

interface PrintfulWebhookEvent {
  type: string
  created: number
  retries: number
  store: number
  data: {
    order?: { id: number; external_id: string; status: string; shipping: string }
    shipment?: {
      carrier: string
      service: string
      tracking_number: string
      tracking_url: string
      shipped_at: number
    }
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get("x-pf-webhook-signature")

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  const event = JSON.parse(rawBody) as PrintfulWebhookEvent

  const printfulOrderId = event.data.order?.id
  if (!printfulOrderId) return NextResponse.json({ ok: true })

  const order = await getOrderByPrintfulOrderId(printfulOrderId)
  if (!order) return NextResponse.json({ ok: true })

  switch (event.type) {
    case "package_shipped": {
      if (order.status === "shipped" || order.status === "refunded" || order.status === "canceled") break
      const s = event.data.shipment
      if (!s) {
        console.error(`[printful webhook] package_shipped for order ${order.id} missing shipment payload`)
        break
      }
      const updated = await updateOrderStatus(order.id, "shipped", {
        tracking_number: s.tracking_number,
        tracking_url: s.tracking_url,
        carrier: s.carrier,
        shipped_at: new Date(s.shipped_at * 1000).toISOString(),
      })
      await sendOrderShippedEmail(updated)
      break
    }
    case "order_updated": {
      const status = event.data.order?.status
      if (
        status === "inprocess" &&
        (order.status === "confirmed" || order.status === "paid")
      ) {
        await updateOrderStatus(order.id, "in_production")
      }
      break
    }
    case "order_failed": {
      await updateOrder(order.id, {
        notes: `${order.notes ?? ""}\n[printful] order_failed event at ${new Date().toISOString()}`.trim(),
      })
      break
    }
  }

  return NextResponse.json({ ok: true })
}
