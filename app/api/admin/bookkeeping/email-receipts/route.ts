// Pending Gmail-polled receipts for the /admin/books/email-receipts surface.
// Read-only list; posting goes through the EXISTING receipts/commit route
// (source_ref receipt:<documentId>, close guard + business-purpose gates).
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listPendingEmailReceiptDocuments } from "@/lib/db/bookkeeping"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const documents = await listPendingEmailReceiptDocuments()
    return NextResponse.json({ documents })
  } catch (error) {
    console.error("[email-receipts] list failed:", error)
    return NextResponse.json({ error: "Failed to load email receipts" }, { status: 500 })
  }
}
