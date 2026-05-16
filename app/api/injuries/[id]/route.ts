import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { injuryFormSchema } from "@/lib/validators/injury"
import { update, getById, resolve } from "@/lib/db/injuries"
import { recordAudit } from "@/lib/audit/record"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const injury = await getById(id)
  if (!injury) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (session.user.role !== "admin" && injury.client_user_id !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  return NextResponse.json({ injury })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const parsed = injuryFormSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const existing = await getById(id)
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (session.user.role !== "admin" && existing.client_user_id !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  if (body.action === "resolve" && parsed.data.date_resolved) {
    const injury = await resolve(id, parsed.data.date_resolved)
    await recordAudit({
      action: "injury.resolved",
      category: "client_action",
      target: { type: "injury", id, label: existing.body_region ?? undefined },
      metadata: { date_resolved: parsed.data.date_resolved },
      request: req,
    })
    return NextResponse.json({ injury })
  }
  const injury = await update(id, parsed.data)
  const slug =
    parsed.data.status === "resolved" && existing.status !== "resolved"
      ? "injury.resolved"
      : "injury.updated"
  await recordAudit({
    action: slug,
    category: "client_action",
    target: { type: "injury", id, label: existing.body_region ?? undefined },
    metadata: { changed: Object.keys(parsed.data) },
    request: req,
  })
  return NextResponse.json({ injury })
}
