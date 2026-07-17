import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getDocument } from "@/lib/db/bookkeeping"
import { signStatementDownload } from "@/lib/bookkeeping/documents"
import { recordAudit } from "@/lib/audit/record"

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const { id } = await ctx.params
    const doc = await getDocument(id)
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })
    const url = await signStatementDownload(doc.storage_path)
    void recordAudit({ action: "bookkeeping.document_downloaded", category: "admin_read_sensitive", outcome: "success",
      target: { type: "bookkeeping_document", id }, request })
    return NextResponse.json({ url })
  } catch (error) {
    console.error("Download bookkeeping document error:", error)
    return NextResponse.json({ error: "Failed to sign download" }, { status: 500 })
  }
}
