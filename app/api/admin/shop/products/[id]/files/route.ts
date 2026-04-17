// app/api/admin/shop/products/[id]/files/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { attachFileToProduct } from "@/lib/db/shop-product-files"
import { z } from "zod"

const body = z.object({
  file_name: z.string().min(1),
  display_name: z.string().min(1),
  storage_path: z.string().min(1),
  file_size_bytes: z.number().int().positive(),
  mime_type: z.string().min(1),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params
  const parsed = body.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const file = await attachFileToProduct({ product_id: id, ...parsed.data })
  return NextResponse.json({ file })
}
