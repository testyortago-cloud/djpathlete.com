import { NextResponse } from "next/server"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { auth } from "@/lib/auth"
import { checkoutRequestSchema } from "@/lib/validators/shop"
import { getVariantsByIds } from "@/lib/db/shop-variants"
import { getProductById } from "@/lib/db/shop-products"
import { createOrder, updateOrder } from "@/lib/db/shop-orders"
import { stripe } from "@/lib/stripe"
import type { ShopOrderItem } from "@/types/database"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { getUnclaimedAttribution } from "@/lib/db/marketing-attribution"

export async function POST(request: Request) {
  if (!isShopEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const body = await request.json()
  const parsed = checkoutRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { items, address, shipping_cents } = parsed.data

  const session = await auth()
  const userId = session?.user?.id ?? null

  const variants = await getVariantsByIds(items.map((i) => i.variant_id))
  const variantMap = new Map(variants.map((v) => [v.id, v]))
  const products = await Promise.all(
    [...new Set(variants.map((v) => v.product_id))].map(getProductById),
  )
  const productMap = new Map(products.filter(Boolean).map((p) => [p!.id, p!]))

  const orderItems: ShopOrderItem[] = []
  for (const line of items) {
    const v = variantMap.get(line.variant_id)
    const p = v ? productMap.get(v.product_id) : undefined
    if (!v || !v.is_available || !p || !p.is_active) {
      return NextResponse.json({ error: "One or more items unavailable" }, { status: 409 })
    }
    orderItems.push({
      variant_id: v.id,
      product_id: v.product_id,
      product_type: (p.product_type === "digital" ? "digital" : "pod") as "pod" | "digital",
      name: p.name,
      variant_name: v.name,
      thumbnail_url: v.mockup_url_override ?? v.mockup_url ?? p.thumbnail_url_override ?? p.thumbnail_url,
      quantity: line.quantity,
      unit_price_cents: v.retail_price_cents,
      printful_variant_id: v.printful_variant_id ?? null,
      printful_cost_cents: v.printful_cost_cents,
    })
  }

  const subtotal_cents = orderItems.reduce((s, i) => s + i.unit_price_cents * i.quantity, 0)
  const total_cents = subtotal_cents + shipping_cents

  const order = await createOrder({
    user_id: userId,
    customer_email: address.email,
    customer_name: address.name,
    shipping_address: address,
    status: "pending",
    items: orderItems,
    subtotal_cents,
    shipping_cents,
    total_cents,
    notes: null,
  } as any)

  const containsDigital = orderItems.some((i) => i.product_type === "digital")
  const containsPod = orderItems.some((i) => i.product_type === "pod")
  const hasPodShipping = containsPod && shipping_cents > 0

  // Resolve visitor tracking params from djp_attr cookie
  const shopAttrSessionId = parseAttrCookie(request.headers.get("cookie"))
  const shopAttr = shopAttrSessionId ? await getUnclaimedAttribution(shopAttrSessionId).catch(() => null) : null

  const origin = new URL(request.url).origin
  const stripeSession = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: address.email,
    line_items: [
      ...orderItems.map((i) => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: `${i.name} — ${i.variant_name}`,
            metadata: {
              product_id: i.product_id,
              variant_id: i.variant_id,
              product_type: i.product_type,
            },
          },
          unit_amount: i.unit_price_cents,
        },
        quantity: i.quantity,
      })),
      ...(hasPodShipping
        ? [
            {
              price_data: {
                currency: "usd",
                product_data: { name: "Shipping" },
                unit_amount: shipping_cents,
              },
              quantity: 1,
            },
          ]
        : []),
    ],
    metadata: {
      type: "shop_order",
      order_id: order.id,
      order_number: order.order_number,
      contains_digital: containsDigital ? "true" : "false",
      contains_pod: containsPod ? "true" : "false",
      gclid:  shopAttr?.gclid  ?? "",
      gbraid: shopAttr?.gbraid ?? "",
      wbraid: shopAttr?.wbraid ?? "",
      fbclid: shopAttr?.fbclid ?? "",
    },
    success_url: `${origin}/shop/orders/${order.order_number}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/shop/cart`,
  })

  await updateOrder(order.id, { stripe_session_id: stripeSession.id })
  return NextResponse.json({ url: stripeSession.url, order_number: order.order_number })
}
