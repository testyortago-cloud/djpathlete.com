import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { affiliateProductInputSchema } from "@/lib/validators/shop-phase2"
import { createAffiliateProduct } from "@/lib/db/shop-products"
import { extractAsin } from "@/lib/shop/amazon"
import { withAudit } from "@/lib/audit/with-audit"

export const POST = withAudit(
  {
    action: "shop.product_created",
    category: "admin_write",
    metadata: async (_req, res) => {
      const id = res.headers.get("x-audit-target-id")
      const slug = res.headers.get("x-audit-target-label")
      return {
        ...(id ? { target_id: id } : {}),
        ...(slug ? { product_slug: slug } : {}),
        product_type: "affiliate",
      }
    },
  },
  async (req: Request) => {
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
      const response = NextResponse.json({ product })
      response.headers.set("x-audit-target-id", product.id)
      response.headers.set("x-audit-target-label", product.slug)
      return response
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
  },
)
