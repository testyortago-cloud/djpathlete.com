// app/api/admin/shop/products/digital/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { digitalProductInputSchema } from "@/lib/validators/shop-phase2"
import { createDigitalProduct } from "@/lib/db/shop-products"

export async function POST(req: Request) {
  await requireAdmin()
  const parsed = digitalProductInputSchema.safeParse(await req.json())
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
    const product = await createDigitalProduct({
      name: v.name,
      slug: v.slug,
      description: v.description,
      thumbnail_url: v.thumbnail_url,
      digital_is_free: v.digital_is_free,
      retail_price_cents: v.retail_price_cents,
      digital_access_days: v.digital_access_days ?? null,
      digital_signed_url_ttl_seconds: v.digital_signed_url_ttl_seconds,
      digital_max_downloads: v.digital_max_downloads ?? null,
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
