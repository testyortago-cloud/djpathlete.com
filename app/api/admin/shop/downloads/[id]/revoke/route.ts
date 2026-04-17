import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { revokeDownload } from "@/lib/db/shop-order-downloads"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params
  await revokeDownload(id)
  return NextResponse.json({ ok: true })
}
