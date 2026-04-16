import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import { updateOrder } from "@/lib/db/shop-orders"

const notesSchema = z.object({
  notes: z.string().max(5000),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = notesSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const order = await updateOrder(id, { notes: parsed.data.notes })
    return NextResponse.json(order)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
