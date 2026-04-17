import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { affiliateProductInputSchema } from "@/lib/validators/shop-phase2"
import { createAffiliateProduct } from "@/lib/db/shop-products"
import { extractAsin } from "@/lib/shop/amazon"

export async function POST(req: Request) {
  await requireAdmin()
  const parsed = affiliateProductInputSchema.safeParse(await req.json())
  if (!parsed.success) {
    const flat = parsed.error.flatten()
    const firstFieldError = Object.entries(flat.fieldErrors)[0]
    const message = firstFieldError
      ? `${firstFieldError[0]}: ${firstFieldError[1]?.[0] ?? "invalid"}`
      : flat.formErrors[0] ?? "Invalid input"
    return NextResponse.json({ error: message, details: flat }, { status: 400 })
  }
  const v = parsed.data
  try {
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
  } catch (err) {
    const e = err as { code?: string; message?: string }
    if (e.code === "23505") {
      return NextResponse.json(
        { error: `A product with slug "${v.slug}" already exists` },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: e.message ?? "Failed to create product" },
      { status: 500 },
    )
  }
}
