import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAsset, updateAsset, deleteAsset } from "@/lib/db/bookkeeping"
import { updateAssetSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const { id } = await ctx.params
    const existing = await getAsset(id)
    if (!existing) return NextResponse.json({ error: "asset not found" }, { status: 404 })
    const body = await request.json().catch(() => null)
    const parsed = updateAssetSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    if (Object.keys(parsed.data).length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 })
    // Cross-field invariant on the MERGED row — the schema can't see the stored half.
    const merged = { ...existing, ...parsed.data }
    if (merged.salvage_cents > merged.basis_cents) {
      return NextResponse.json({ error: "salvage cannot exceed basis" }, { status: 400 })
    }
    const asset = await updateAsset(id, parsed.data)
    void recordAudit({ action: "bookkeeping.asset_updated", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_asset", id, label: asset.name },
      metadata: { updated_fields: Object.keys(parsed.data) }, request })
    return NextResponse.json({ asset })
  } catch (error) {
    console.error("Update bookkeeping asset error:", error)
    return NextResponse.json({ error: "Failed to update asset" }, { status: 500 })
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const { id } = await ctx.params
    const existing = await getAsset(id)
    if (!existing) return NextResponse.json({ error: "asset not found" }, { status: 404 })
    await deleteAsset(id)
    // Hard delete — the audit row carries the full snapshot so nothing is lost.
    void recordAudit({ action: "bookkeeping.asset_deleted", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_asset", id, label: existing.name },
      metadata: {
        book_id: existing.book_id, basis_cents: existing.basis_cents, salvage_cents: existing.salvage_cents,
        in_service_on: existing.in_service_on, method: existing.method, convention: existing.convention,
        recovery_years: existing.recovery_years, accountant_note: existing.accountant_note,
      }, request })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Delete bookkeeping asset error:", error)
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 })
  }
}
