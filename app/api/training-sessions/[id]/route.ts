import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { trainingSessionFormSchema } from "@/lib/validators/training-session"
import { update, deleteOne, getById } from "@/lib/db/training-sessions"
import { runEvaluation } from "@/lib/coach-intel/run-evaluation"
import { recordAudit } from "@/lib/audit/record"
import { createServiceRoleClient } from "@/lib/supabase"

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

  // training_sessions has no `status` column — the act of PATCHing a logged
  // session is the boundary signal. Emit `workout.completed`. We try to
  // attach a set count from `tracked_exercises` joined via the assignment,
  // and degrade gracefully (set_count: null) on any failure.
  let setCount: number | null = null
  if (updated.program_assignment_id) {
    try {
      const supabase = createServiceRoleClient()
      const { count } = await supabase
        .from("tracked_exercises")
        .select("*", { count: "exact", head: true })
        .eq("assignment_id", updated.program_assignment_id)
      setCount = count ?? null
    } catch {
      setCount = null
    }
  }

  await recordAudit({
    action: "workout.completed",
    category: "client_action",
    target: { type: "training_session", id, label: updated.session_type ?? undefined },
    metadata: {
      program_assignment_id: updated.program_assignment_id ?? null,
      date: updated.date ?? null,
      session_type: updated.session_type ?? null,
      duration_min: updated.duration_min ?? null,
      rpe: updated.rpe ?? null,
      session_load: updated.session_load ?? null,
      set_count: setCount,
    },
    request: req,
  })

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
