import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateEntry, deleteEntry } from "@/lib/db/bookkeeping"
import { updateEntrySchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const { id } = await ctx.params
  const body = await request.json().catch(() => null)
  const parsed = updateEntrySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  const entry = await updateEntry(id, parsed.data)
  void recordAudit({ action: "bookkeeping.entry_updated", category: "commerce", outcome: "success",
    target: { type: "bookkeeping_entry", id }, request })
  return NextResponse.json({ entry })
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const { id } = await ctx.params
  await deleteEntry(id)
  void recordAudit({ action: "bookkeeping.entry_deleted", category: "commerce", outcome: "success",
    target: { type: "bookkeeping_entry", id }, request })
  return NextResponse.json({ ok: true })
}
