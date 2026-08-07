import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { packProductSchema } from "@/lib/validators/session-packs"
import { listAllProducts, createProduct } from "@/lib/db/session-pack-products"
import { canAccessAdminPath } from "@/lib/permissions/guard"

/** GET — the full pack catalogue (active + archived). */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    return NextResponse.json({ products: await listAllProducts() })
  } catch (error) {
    console.error("List pack products error:", error)
    return NextResponse.json({ error: "Failed to load products" }, { status: 500 })
  }
}

/** POST — create a catalogue product (a standard pack the coach sells repeatedly). */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const parsed = packProductSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid product", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const p = parsed.data
    const product = await createProduct({
      name: p.name,
      session_type: p.sessionType,
      credits: p.credits,
      price_cents: p.priceCents,
      validity_days: p.validityDays ?? null,
      stripe_price_id: p.stripePriceId ?? null,
      is_active: p.isActive ?? true,
      sort_order: p.sortOrder ?? 0,
    })
    return NextResponse.json({ product }, { status: 201 })
  } catch (error) {
    console.error("Create pack product error:", error)
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 })
  }
}
