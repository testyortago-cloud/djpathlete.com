import { NextResponse } from "next/server"
import { shippingQuoteRequestSchema } from "@/lib/validators/shop"
import { getVariantsByIds } from "@/lib/db/shop-variants"
import { getShippingRates, PrintfulError } from "@/lib/printful"

export async function POST(request: Request) {
  const body = await request.json()
  const parsed = shippingQuoteRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { items, address } = parsed.data

  const variantIds = items.map((i) => i.variant_id)
  const variants = await getVariantsByIds(variantIds)
  const variantMap = new Map(variants.map((v) => [v.id, v]))

  const lines = items.map((i) => {
    const v = variantMap.get(i.variant_id)
    if (!v || !v.is_available) return null
    return {
      variant_id: v.id,
      quantity: i.quantity,
      printful_variant_id: v.printful_variant_id,
      unit_price_cents: v.retail_price_cents,
    }
  })
  if (lines.some((l) => l === null))
    return NextResponse.json({ error: "One or more items unavailable" }, { status: 409 })
  const valid = lines as NonNullable<(typeof lines)[number]>[]

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
      items: valid.map((l) => ({ variant_id: l.printful_variant_id, quantity: l.quantity })),
    })
    if (rates.length === 0)
      return NextResponse.json(
        { error: "No shipping options available for this address" },
        { status: 422 },
      )
    const cheapest = rates.reduce((a, b) => (parseFloat(a.rate) <= parseFloat(b.rate) ? a : b))
    const shipping_cents = Math.round(parseFloat(cheapest.rate) * 100)
    const subtotal_cents = valid.reduce((s, l) => s + l.unit_price_cents * l.quantity, 0)
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
