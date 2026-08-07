import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateAccount } from "@/lib/db/bookkeeping"
import { updateAccountSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const { id } = await ctx.params
    const body = await request.json().catch(() => null)
    const parsed = updateAccountSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
    const { archived, ...rest } = parsed.data
    const updates: Record<string, unknown> = { ...rest }
    if (archived !== undefined) updates.archived_at = archived ? new Date().toISOString() : null
    const account = await updateAccount(id, updates)
    void recordAudit({ action: "bookkeeping.account_updated", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_account", id, label: account.name }, request })
    return NextResponse.json({ account })
  } catch (error) {
    console.error("Update bookkeeping account error:", error)
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 })
  }
}
