import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getUserById } from "@/lib/db/users"
import { setBillingPayer, clearBillingPayer } from "@/lib/db/client-billing-payers"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const bodySchema = z.object({ payerUserId: z.string().uuid().nullable() })

/** Set or clear a client's billing payer (the person whose card covers their
 *  automatic charges). payerUserId null = clear (they pay for themselves). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const { id } = await ctx.params
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

    const payerUserId = parsed.data.payerUserId
    if (payerUserId === null) {
      await clearBillingPayer(id)
    } else {
      if (payerUserId === id) {
        return NextResponse.json({ error: "A client can't be their own payer" }, { status: 400 })
      }
      const payer = await getUserById(payerUserId).catch(() => null)
      if (!payer) return NextResponse.json({ error: "Payer not found" }, { status: 404 })
      if (payer.role !== "client") {
        return NextResponse.json({ error: "Payer must be a client" }, { status: 400 })
      }
      await setBillingPayer(id, payerUserId, session.user.id)
    }

    void recordAudit({
      action: "client.billing_payer_set",
      category: "admin_write",
      outcome: "success",
      target: { type: "user", id },
      metadata: { payer_user_id: payerUserId },
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Set billing payer error:", error)
    return NextResponse.json({ error: "Failed to update billing payer" }, { status: 500 })
  }
}
