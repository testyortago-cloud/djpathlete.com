import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { getClientPackageByIdMaybe } from "@/lib/db/client-packages"
import { changePackPrice } from "@/lib/services/pack-payment-link"
import { recordAudit } from "@/lib/audit/record"

const bodySchema = z.object({ priceCents: z.number().int().min(1).max(99999999) })

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a total between $0.01 and $999,999.99" }, { status: 400 })
    }
    const { id } = await ctx.params
    const pack = await getClientPackageByIdMaybe(id)
    if (!pack) return NextResponse.json({ error: "Pack not found" }, { status: 404 })
    const result = await changePackPrice(pack, parsed.data.priceCents)
    if (!result.ok && !result.priceSaved) return NextResponse.json({ error: result.error }, { status: result.status })
    revalidatePath(`/admin/clients/${pack.client_user_id}`)
    revalidatePath("/client/sessions")
    void recordAudit({
      action: "pack.price_changed",
      category: "commerce",
      outcome: "success",
      target: { type: "client_package", id, label: pack.session_type },
      metadata: {
        client_user_id: pack.client_user_id,
        previous_price_cents: result.previousPriceCents ?? pack.price_cents,
        price_cents: parsed.data.priceCents,
      },
      request,
    })
    if (!result.ok) return NextResponse.json({ error: result.error, priceSaved: true }, { status: result.status })
    return NextResponse.json({ priceCents: parsed.data.priceCents, url: result.url })
  } catch (error) {
    console.error("Change pack price error:", error)
    return NextResponse.json({ error: "Failed to change the pack price" }, { status: 500 })
  }
}
