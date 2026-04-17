// app/api/admin/shop/products/[id]/files/[fileId]/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { deleteProductFile, updateProductFile } from "@/lib/db/shop-product-files"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  await requireAdmin()
  const { fileId } = await params
  const body = await req.json()
  await updateProductFile(fileId, {
    display_name: body.display_name,
    sort_order: body.sort_order,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  await requireAdmin()
  const { fileId } = await params
  await deleteProductFile(fileId)
  return NextResponse.json({ ok: true })
}
