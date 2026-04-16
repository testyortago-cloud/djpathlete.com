import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { adminRefundSchema } from "@/lib/validators/shop"
import { refundShopOrder } from "@/lib/shop/fulfillment"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
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
}
