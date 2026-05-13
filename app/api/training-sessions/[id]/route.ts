import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { trainingSessionFormSchema } from "@/lib/validators/training-session"
import { update, deleteOne, getById } from "@/lib/db/training-sessions"
import { runEvaluation } from "@/lib/coach-intel/run-evaluation"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const existing = await getById(id)
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (session.user.role !== "admin" && existing.client_user_id !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const body = await req.json()
  const parsed = trainingSessionFormSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const updated = await update(id, parsed.data)
  try {
    await runEvaluation(existing.client_user_id, updated.date)
  } catch (e) {
    console.error("[training-sessions] runEvaluation failed", e)
  }
  return NextResponse.json({ session: updated })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const existing = await getById(id)
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (session.user.role !== "admin" && existing.client_user_id !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  await deleteOne(id)
  return NextResponse.json({ ok: true })
}
