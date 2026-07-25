// Dismiss / restore an insight finding (5b, decision B-2). Admin self-gated
// (/api/* is NOT in the middleware matcher), audited both ways. The body
// fingerprint is opaque here — identity semantics live in finding-fingerprint.ts.
import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { deleteDismissal, insertDismissal } from "@/lib/db/bookkeeping"

const dismissalBodySchema = z.object({ book_id: z.string().uuid(), fingerprint: z.string().min(1) })

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
    if (mode === "dismiss") {
      await insertDismissal({ book_id, fingerprint, dismissed_by: session.user.id })
    } else {
      await deleteDismissal(book_id, fingerprint)
    }
    void recordAudit({
      action: mode === "dismiss" ? "bookkeeping.finding_dismissed" : "bookkeeping.finding_undismissed",
      category: "commerce",
      outcome: "success",
      target: { type: "bookkeeping_finding", id: fingerprint, label: fingerprint },
      metadata: { book_id, fingerprint },
      request,
    })
    return NextResponse.json({ ok: true })
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
