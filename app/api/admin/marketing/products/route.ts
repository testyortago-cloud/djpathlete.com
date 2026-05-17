// app/api/admin/marketing/products/route.ts
// POST creates a new marketing_products row. Admin-only.
// List is read directly by the server-component page; no GET handler here.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createMarketingProduct } from "@/lib/db/marketing-products"
import { marketingProductInputSchema } from "@/lib/validators/marketing-products"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const raw = await request.json().catch(() => null)
  const parsed = marketingProductInputSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const product = await createMarketingProduct(parsed.data)
    return NextResponse.json({ product }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown"
    const isUnique = msg.includes("duplicate key") || msg.includes("unique")
    return NextResponse.json(
      { error: isUnique ? `Slug "${parsed.data.slug}" already exists` : msg },
      { status: isUnique ? 409 : 500 },
    )
  }
}
