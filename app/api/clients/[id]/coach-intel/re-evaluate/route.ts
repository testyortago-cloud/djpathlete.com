import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { runEvaluation } from "@/lib/coach-intel/run-evaluation"

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const { id } = await params
  const today = new Date().toISOString().slice(0, 10)
  const result = await runEvaluation(id, today)
  return NextResponse.json({ result })
}
