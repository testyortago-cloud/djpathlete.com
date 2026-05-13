import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { acknowledge, dismiss } from "@/lib/db/risk-flags"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json()
  if (body.action === "acknowledge") {
    const flag = await acknowledge(id, session.user.id)
    return NextResponse.json({ flag })
  }
  if (body.action === "dismiss") {
    const flag = await dismiss(id, session.user.id)
    return NextResponse.json({ flag })
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 })
}
