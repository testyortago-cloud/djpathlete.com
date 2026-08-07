import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getDocument, deleteDocument } from "@/lib/db/bookkeeping"
import { deleteStatementFile } from "@/lib/bookkeeping/documents"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const { id } = await ctx.params
    const doc = await getDocument(id)
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })
    await deleteStatementFile(doc.storage_path)
    await deleteDocument(id)
    void recordAudit({ action: "bookkeeping.document_deleted", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_document", id }, request })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Delete bookkeeping document error:", error)
    return NextResponse.json({ error: "Failed to delete document" }, { status: 500 })
  }
}
