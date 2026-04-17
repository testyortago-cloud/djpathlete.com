import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { bumpMaxDownloads } from "@/lib/db/shop-order-downloads"
import { z } from "zod"

const body = z.object({ max: z.number().int().positive().nullable() })

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
  await bumpMaxDownloads(id, parsed.data.max)
  return NextResponse.json({ ok: true })
}
