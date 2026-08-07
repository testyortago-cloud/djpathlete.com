import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getDocument } from "@/lib/db/bookkeeping"
import { signStatementDownload } from "@/lib/bookkeeping/documents"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const { id } = await ctx.params
    const doc = await getDocument(id)
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })
    // 1 hour, not the 5-minute default: these links back the email-receipts
    // review previews, and a review session parked past the TTL rendered an
    // "ExpiredToken" error where the receipt should be (2026-08-03). The
    // client also refetches a fresh link on every dialog open, so the pair
    // covers both long sessions and overnight tabs. Admin-gated route;
    // the signed URL itself stays unguessable and time-boxed.
    const url = await signStatementDownload(doc.storage_path, 3600)
    void recordAudit({ action: "bookkeeping.document_downloaded", category: "admin_read_sensitive", outcome: "success",
      target: { type: "bookkeeping_document", id }, request })
    // redirect=1: durable href mode. New-tab / history / bookmarked opens hit
    // THIS admin-gated route and get 302'd to a signature minted per hit, so
    // the link a coach keeps open overnight can never rot into GCS
    // ExpiredToken XML (2026-08-03 report — a raw signed URL reopened after
    // its TTL). JSON stays the default for fetch-then-embed callers.
    if (new URL(request.url).searchParams.get("redirect") === "1") {
      return NextResponse.redirect(url, 302)
    }
    return NextResponse.json({ url })
  } catch (error) {
    console.error("Download bookkeeping document error:", error)
    return NextResponse.json({ error: "Failed to sign download" }, { status: 500 })
  }
}
