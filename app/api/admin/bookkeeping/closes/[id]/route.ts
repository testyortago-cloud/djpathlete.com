// Reopen = DELETE the close row (D-1). The audit metadata carries the full
// snapshot, so append-only history loses nothing; re-closing re-snapshots.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { deleteClose, getCloseById } from "@/lib/db/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const { id } = await ctx.params
    const close = await getCloseById(id)
    if (!close) return NextResponse.json({ error: "close not found" }, { status: 404 })
    await deleteClose(id)
    void recordAudit({
      action: "bookkeeping.period_reopened", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_period_close", id },
      metadata: {
        book_id: close.book_id, period: close.period,
        income_cents: close.income_cents, expense_cents: close.expense_cents,
        net_cents: close.net_cents, entry_count: close.entry_count,
        closed_at: close.closed_at, closed_by: close.closed_by, email_sent_at: close.email_sent_at,
      },
      request,
    })
    return NextResponse.json({ reopened: true })
  } catch (error) {
    console.error("Reopen period error:", error)
    return NextResponse.json({ error: "Failed to reopen the month" }, { status: 500 })
  }
}
