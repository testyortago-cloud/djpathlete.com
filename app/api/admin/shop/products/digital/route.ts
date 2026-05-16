// app/api/admin/shop/products/digital/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { digitalProductInputSchema } from "@/lib/validators/shop-phase2"
import { createDigitalProduct } from "@/lib/db/shop-products"
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
        product_type: "digital",
      }
    },
  },
  async (req: Request) => {
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
