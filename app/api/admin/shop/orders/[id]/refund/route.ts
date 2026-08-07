import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { adminRefundSchema } from "@/lib/validators/shop"
import { refundShopOrder } from "@/lib/shop/fulfillment"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export const POST = withAudit(
  {
    action: "shop.order_refunded",
    category: "commerce",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "shop_order", id }
    },
    metadata: async (_req, res) => {
      if (!res.ok) return {}
      try {
        const body = await res.json() as { order_number?: string; refund_cents?: number; status?: string }
        return {
          order_number: body.order_number,
          refund_cents: body.refund_cents,
          status: body.status,
        }
      } catch {
        return {}
      }
    },
  },
  async (req: Request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const parsed = adminRefundSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    try {
      const order = await refundShopOrder(id, parsed.data.amount_cents, parsed.data.reason)
      return NextResponse.json(order)
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 })
    }
  },
)
