import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { extendDownloadAccess } from "@/lib/db/shop-order-downloads"
import { z } from "zod"

const body = z.object({ expires_at: z.string().datetime() })

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params
  const parsed = body.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  await extendDownloadAccess(id, parsed.data.expires_at)
  return NextResponse.json({ ok: true })
}
