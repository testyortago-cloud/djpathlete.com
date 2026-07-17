import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listPlatformIncome } from "@/lib/db/bookkeeping"
import { buildIncomeDrafts } from "@/lib/bookkeeping/income-adapter"
import { importPreviewSchema } from "@/lib/validators/bookkeeping"

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const body = await request.json().catch(() => null)
  const parsed = importPreviewSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  const sources = await listPlatformIncome(parsed.data.from, parsed.data.to)
  const { drafts, warnings } = buildIncomeDrafts(sources)
  return NextResponse.json({ drafts, warnings })
}
