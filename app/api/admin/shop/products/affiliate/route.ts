import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { affiliateProductInputSchema } from "@/lib/validators/shop-phase2"
import { createAffiliateProduct } from "@/lib/db/shop-products"
import { extractAsin } from "@/lib/shop/amazon"

export async function POST(req: Request) {
  await requireAdmin()
  const parsed = affiliateProductInputSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const v = parsed.data
  const product = await createAffiliateProduct({
    name: v.name,
    slug: v.slug,
    description: v.description,
    thumbnail_url: v.thumbnail_url,
    affiliate_url: v.affiliate_url,
    affiliate_asin: v.affiliate_asin ?? extractAsin(v.affiliate_url),
    affiliate_price_cents: v.affiliate_price_cents ?? null,
  })
  return NextResponse.json({ product })
}
