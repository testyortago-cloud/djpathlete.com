import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { adminUpdateVariantSchema } from "@/lib/validators/shop"
import { updateVariant } from "@/lib/db/shop-variants"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const body = await request.json()
  const parsed = adminUpdateVariantSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const updated = await updateVariant(id, parsed.data)
  return NextResponse.json(updated)
}
