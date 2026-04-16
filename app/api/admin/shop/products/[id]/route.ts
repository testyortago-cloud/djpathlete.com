import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { adminUpdateProductSchema } from "@/lib/validators/shop"
import { updateProduct } from "@/lib/db/shop-products"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await params
  const body = await request.json()
  const parsed = adminUpdateProductSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const updated = await updateProduct(id, parsed.data)
  return NextResponse.json(updated)
}
