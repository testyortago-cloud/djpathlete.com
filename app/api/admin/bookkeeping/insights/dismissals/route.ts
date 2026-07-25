// Dismiss / restore an insight finding (5b, decision B-2). Admin self-gated
// (/api/* is NOT in the middleware matcher), audited both ways. The body
// fingerprint is opaque here — identity semantics live in finding-fingerprint.ts.
import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { deleteDismissal, insertDismissal } from "@/lib/db/bookkeeping"

// Upper bound on the fingerprint: the column is unbounded TEXT and the value is
// echoed into audit_logs.target_label (uncapped). 512 is far above any real
// "<finder>:<uuid>" or normalized vendor descriptor.
const dismissalBodySchema = z.object({ book_id: z.string().uuid(), fingerprint: z.string().min(1).max(512) })

async function handle(request: Request, mode: "dismiss" | "undismiss") {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const parsed = dismissalBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    }
    const { book_id, fingerprint } = parsed.data
    // insert is an ignoreDuplicates upsert (re-dismissing is a no-op we still
    // want on the trail — the owner asserted the intent). A delete that removed
    // nothing changed no state, so it gets no "restored" row: the audit log is
    // the record of what changed, not of what was clicked.
    let deleted = 0
    if (mode === "dismiss") {
      await insertDismissal({ book_id, fingerprint, dismissed_by: session.user.id })
    } else {
      deleted = await deleteDismissal(book_id, fingerprint)
    }
    if (mode === "dismiss" || deleted > 0) {
      void recordAudit({
        action: mode === "dismiss" ? "bookkeeping.finding_dismissed" : "bookkeeping.finding_undismissed",
        category: "commerce",
        outcome: "success",
        target: { type: "bookkeeping_finding", id: fingerprint, label: fingerprint },
        metadata: { book_id, fingerprint },
        request,
      })
    }
    return NextResponse.json(mode === "dismiss" ? { ok: true } : { ok: true, deleted })
  } catch (error) {
    console.error("bookkeeping finding dismissal:", error)
    return NextResponse.json({ error: "Failed to update the dismissal" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return handle(request, "dismiss")
}

export async function DELETE(request: Request) {
  return handle(request, "undismiss")
}
