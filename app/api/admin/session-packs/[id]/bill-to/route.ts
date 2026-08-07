import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getClientPackageByIdMaybe } from "@/lib/db/client-packages"
import { changePackBillTo } from "@/lib/services/pack-payment-link"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const bodySchema = z.object({ billToEmail: z.string().email().nullable() })

/**
 * PATCH — change (or clear) who this pack's payment link is addressed to.
 *
 * Stripe bakes customer_email into a Checkout session at creation, so this
 * re-issues the link: any URL already shared stops working. That is the point —
 * the old link is addressed to the wrong person.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const { id } = await ctx.params

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 })
    }

    const pack = await getClientPackageByIdMaybe(id)
    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 })
    }

    const result = await changePackBillTo(pack, parsed.data.billToEmail)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    void recordAudit({
      action: "pack.bill_to_changed",
      category: "commerce",
      outcome: "success",
      target: { type: "client_package", id, label: pack.session_type },
      metadata: {
        client_user_id: pack.client_user_id,
        bill_to_email: parsed.data.billToEmail,
        previous_bill_to_email: pack.bill_to_email,
      },
      request,
    })

    return NextResponse.json({ url: result.url, billToEmail: parsed.data.billToEmail })
  } catch (error) {
    console.error("Change pack bill-to error:", error)
    return NextResponse.json({ error: "Failed to change the billing email" }, { status: 500 })
  }
}
