import { NextResponse } from "next/server"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { z } from "zod"
import { getVariantsByIds } from "@/lib/db/shop-variants"
import { getProductById } from "@/lib/db/shop-products"

const BodySchema = z.object({
  variant_ids: z.array(z.string().uuid()).min(1).max(50),
})

export interface CartItemResponse {
  variant_id: string
  product_id: string
  product_type: "pod" | "digital" | "affiliate"
  product_slug: string
  product_name: string
  variant_name: string
  thumbnail_url: string
  unit_price_cents: number
  is_available: boolean
  printful_variant_id: number
}

export async function POST(request: Request) {
  if (!isShopEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { variant_ids } = parsed.data

  try {
    const variants = await getVariantsByIds(variant_ids)

    // Fetch unique products in parallel
    const uniqueProductIds = Array.from(new Set(variants.map((v) => v.product_id)))
    const products = await Promise.all(uniqueProductIds.map((id) => getProductById(id)))
    const productMap = new Map(
      products.filter(Boolean).map((p) => [p!.id, p!]),
    )

    const items: CartItemResponse[] = variant_ids.flatMap((variant_id) => {
      const variant = variants.find((v) => v.id === variant_id)
      if (!variant) return []
      const product = productMap.get(variant.product_id)
      if (!product) return []

      const thumbnail_url =
        variant.mockup_url_override ??
        variant.mockup_url ??
        product.thumbnail_url_override ??
        product.thumbnail_url

      const is_available = variant.is_available && product.is_active

      return [
        {
          variant_id: variant.id,
          product_id: product.id,
          product_type: product.product_type,
          product_slug: product.slug,
          product_name: product.name,
          variant_name: variant.name,
          thumbnail_url,
          unit_price_cents: variant.retail_price_cents,
          is_available,
          printful_variant_id: variant.printful_variant_id,
        },
      ]
    })

    return NextResponse.json({ items })
  } catch (err) {
    console.error("[shop cart-items]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
