import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getReadinessTrend } from "@/lib/db/daily-readiness"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  if (session.user.role !== "admin" && session.user.id !== id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const url = new URL(req.url)
  const days = Math.min(Number(url.searchParams.get("days") ?? 30) || 30, 365)
  const trend = await getReadinessTrend(id, days)
  return NextResponse.json({ trend })
}
