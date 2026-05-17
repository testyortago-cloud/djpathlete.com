// app/api/admin/marketing/products/[slug]/route.ts
// PUT updates a single field set on an existing product; DELETE removes it.
// Admin-only. Slug itself is immutable via PUT — change requires delete +
// recreate to preserve referential clarity for the ads agent's cached refs.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  deleteMarketingProduct,
  updateMarketingProduct,
} from "@/lib/db/marketing-products"
import { marketingProductPatchSchema } from "@/lib/validators/marketing-products"

interface RouteContext {
  params: Promise<{ slug: string }>
}

export async function PUT(request: NextRequest, ctx: RouteContext) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { slug } = await ctx.params

  const raw = await request.json().catch(() => null)
  const parsed = marketingProductPatchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    )
  }
  // Slug is the primary key — never let a PUT body rename it.
  const { slug: _ignored, ...patch } = parsed.data

  try {
    const product = await updateMarketingProduct(slug, patch)
    return NextResponse.json({ product })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, ctx: RouteContext) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { slug } = await ctx.params

  try {
    await deleteMarketingProduct(slug)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
