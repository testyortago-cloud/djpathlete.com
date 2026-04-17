import { NextResponse } from "next/server"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { shippingQuoteRequestSchema } from "@/lib/validators/shop"
import { getVariantsByIds } from "@/lib/db/shop-variants"
import { createServiceRoleClient } from "@/lib/supabase"
import { getShippingRates, PrintfulError } from "@/lib/printful"
import type { ProductType } from "@/types/database"

export async function POST(request: Request) {
  if (!isShopEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const body = await request.json()
  const parsed = shippingQuoteRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { items, address } = parsed.data

  const variantIds = items.map((i) => i.variant_id)
  const variants = await getVariantsByIds(variantIds)
  const variantMap = new Map(variants.map((v) => [v.id, v]))

  const productIds = Array.from(new Set(variants.map((v) => v.product_id)))
  const productTypeById = new Map<string, ProductType>()
  if (productIds.length > 0) {
    const supabase = createServiceRoleClient()
    const { data: products, error } = await supabase
      .from("shop_products")
      .select("id, product_type")
      .in("id", productIds)
    // Non-fatal: if we can't look up product types (e.g., invalid UUIDs in
    // tests, or a transient Supabase error), default every line to 'pod' so
    // the existing POD shipping path still works.
    if (!error && products) {
      for (const p of products as { id: string; product_type: ProductType }[]) {
        productTypeById.set(p.id, p.product_type)
      }
    }
  }

  const lines = items.map((i) => {
    const v = variantMap.get(i.variant_id)
    if (!v || !v.is_available) return null
    return {
      variant_id: v.id,
      quantity: i.quantity,
      printful_variant_id: v.printful_variant_id,
      unit_price_cents: v.retail_price_cents,
      product_type: productTypeById.get(v.product_id) ?? ("pod" as ProductType),
    }
  })
  if (lines.some((l) => l === null))
    return NextResponse.json({ error: "One or more items unavailable" }, { status: 409 })
  const valid = lines as NonNullable<(typeof lines)[number]>[]
  const subtotal_cents = valid.reduce((s, l) => s + l.unit_price_cents * l.quantity, 0)

  const podLines = valid.filter(
    (l) => l.product_type === "pod" && l.printful_variant_id != null,
  )

  // Digital/affiliate-only cart → no shipping, no Printful call.
  if (podLines.length === 0) {
    return NextResponse.json({
      shipping_cents: 0,
      shipping_label: "Digital delivery",
      subtotal_cents,
      total_cents: subtotal_cents,
    })
  }

  try {
    const rates = await getShippingRates({
      recipient: {
        name: address.name,
        email: address.email,
        phone: address.phone,
        address1: address.line1,
        address2: address.line2,
        city: address.city,
        state_code: address.state,
        country_code: address.country,
        zip: address.postal_code,
      },
      items: podLines.map((l) => ({
        variant_id: l.printful_variant_id as number,
        quantity: l.quantity,
      })),
    })
    if (rates.length === 0)
      return NextResponse.json(
        { error: "No shipping options available for this address" },
        { status: 422 },
      )
    const cheapest = rates.reduce((a, b) => (parseFloat(a.rate) <= parseFloat(b.rate) ? a : b))
    const shipping_cents = Math.round(parseFloat(cheapest.rate) * 100)
    return NextResponse.json({
      shipping_cents,
      shipping_label: cheapest.name,
      subtotal_cents,
      total_cents: subtotal_cents + shipping_cents,
    })
  } catch (err) {
    if (err instanceof PrintfulError) return NextResponse.json({ error: err.message }, { status: 502 })
    throw err
  }
}
