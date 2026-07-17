import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateEntry, deleteEntry, getEntry, assertAccountInBook } from "@/lib/db/bookkeeping"
import { updateEntrySchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const { id } = await ctx.params
    const body = await request.json().catch(() => null)
    const parsed = updateEntrySchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
    if (parsed.data.account_id) {
      const entry = await getEntry(id)
      if (!entry) return NextResponse.json({ error: "entry not found" }, { status: 404 })
      const effectiveDirection = parsed.data.direction ?? entry.direction
      try {
        await assertAccountInBook(parsed.data.account_id, entry.book_id, effectiveDirection)
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === "ACCOUNT_NOT_FOUND") return NextResponse.json({ error: "account not found" }, { status: 404 })
        if (code === "WRONG_BOOK" || code === "WRONG_TYPE") return NextResponse.json({ error: (e as Error).message }, { status: 409 })
        throw e
      }
    }
    const entry = await updateEntry(id, parsed.data)
    void recordAudit({ action: "bookkeeping.entry_updated", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_entry", id }, request })
    return NextResponse.json({ entry })
  } catch (error) {
    console.error("Update bookkeeping entry error:", error)
    return NextResponse.json({ error: "Failed to update entry" }, { status: 500 })
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const { id } = await ctx.params
    await deleteEntry(id)
    void recordAudit({ action: "bookkeeping.entry_deleted", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_entry", id }, request })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Delete bookkeeping entry error:", error)
    return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 })
  }
}
