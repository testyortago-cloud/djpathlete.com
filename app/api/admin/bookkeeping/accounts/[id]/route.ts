import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateAccount } from "@/lib/db/bookkeeping"
import { updateAccountSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
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
}
