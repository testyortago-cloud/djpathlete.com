import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { confirmOrderToPrintful } from "@/lib/shop/fulfillment"
import { sendOrderConfirmedEmail } from "@/lib/shop/emails"

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
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
}
