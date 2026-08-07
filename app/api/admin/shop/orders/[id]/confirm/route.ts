import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { confirmOrderToPrintful } from "@/lib/shop/fulfillment"
import { sendOrderConfirmedEmail } from "@/lib/shop/emails"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"

// "Confirm" pushes the order to Printful for production. Closest slug in the
// v1 taxonomy is shop.order_fulfilled (no separate "confirmed" or "submitted"
// slug exists). Printful webhook later fires the same slug on package_shipped
// — both are valid lifecycle checkpoints toward fulfillment.
export const POST = withAudit(
  {
    action: "shop.order_fulfilled",
    category: "commerce",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "shop_order", id }
    },
    metadata: async (_req, res) => {
      if (!res.ok) return { step: "confirm_to_printful" }
      try {
        const body = await res.json() as { order_number?: string; status?: string; printful_order_id?: number | null }
        return {
          step: "confirm_to_printful",
          order_number: body.order_number,
          status: body.status,
          printful_order_id: body.printful_order_id ?? null,
        }
      } catch {
        return { step: "confirm_to_printful" }
      }
    },
  },
  async (_req: Request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params

    try {
      const order = await confirmOrderToPrintful(id)
      await sendOrderConfirmedEmail(order)
      return NextResponse.json(order)
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 })
    }
  },
)
