import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { getLead, markLeadFailed, markLeadSynced } from "@/lib/db/shop-leads"
import { addContactToAudience } from "@/lib/shop/resend-audience"
import { getProductById } from "@/lib/db/shop-products"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params
  const lead = await getLead(id)
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 })
  const product = await getProductById(lead.product_id)
  if (!product) return NextResponse.json({ error: "product gone" }, { status: 404 })
  try {
    const contactId = await addContactToAudience({
      email: lead.email,
      firstName: null,
      lastName: null,
      tag: `lead-magnet:${product.slug}`,
    })
    await markLeadSynced(lead.id, contactId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    await markLeadFailed(lead.id, String((e as Error).message ?? e))
    return NextResponse.json({ error: "retry failed" }, { status: 502 })
  }
}
