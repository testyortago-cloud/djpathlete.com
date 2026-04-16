import { NextResponse } from "next/server"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { orderLookupSchema } from "@/lib/validators/shop"
import { getOrderByNumber } from "@/lib/db/shop-orders"
import { rateLimit } from "@/lib/shop/rate-limit"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderNumber: string }> },
) {
  if (!isShopEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const { orderNumber } = await params

  const rl = rateLimit(`lookup:${orderNumber}`, 5, 10 * 60 * 1000)
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many attempts, try later" }, { status: 429 })
  }

  const body = await request.json()
  const parsed = orderLookupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const order = await getOrderByNumber(orderNumber)
  if (!order || order.customer_email.toLowerCase() !== parsed.data.email.toLowerCase()) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 })
  }

  return NextResponse.json({
    order_number: order.order_number,
    status: order.status,
    items: order.items,
    shipping_address: order.shipping_address,
    subtotal_cents: order.subtotal_cents,
    shipping_cents: order.shipping_cents,
    total_cents: order.total_cents,
    tracking_number: order.tracking_number,
    tracking_url: order.tracking_url,
    carrier: order.carrier,
    created_at: order.created_at,
    shipped_at: order.shipped_at,
  })
}
