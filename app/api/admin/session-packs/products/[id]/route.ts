import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { packProductUpdateSchema } from "@/lib/validators/session-packs"
import { updateProduct } from "@/lib/db/session-pack-products"
import { canAccessAdminPath } from "@/lib/permissions/guard"

/** PATCH — update a catalogue product (edit fields or activate/deactivate). */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const { id } = await ctx.params
    const parsed = packProductUpdateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid product", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const p = parsed.data
    const patch: Record<string, unknown> = {}
    if (p.name !== undefined) patch.name = p.name
    if (p.sessionType !== undefined) patch.session_type = p.sessionType
    if (p.credits !== undefined) patch.credits = p.credits
    if (p.priceCents !== undefined) patch.price_cents = p.priceCents
    if (p.validityDays !== undefined) patch.validity_days = p.validityDays
    if (p.stripePriceId !== undefined) patch.stripe_price_id = p.stripePriceId
    if (p.isActive !== undefined) patch.is_active = p.isActive
    if (p.sortOrder !== undefined) patch.sort_order = p.sortOrder
    return NextResponse.json({ product: await updateProduct(id, patch) })
  } catch (error) {
    console.error("Update pack product error:", error)
    return NextResponse.json({ error: "Failed to update product" }, { status: 500 })
  }
}
