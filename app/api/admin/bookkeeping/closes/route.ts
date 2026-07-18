// Phase 6a: list + create period closes. The close is a TOTALS freeze, not a
// document freeze (D-5) — document links may still be pruned by retention.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBook, getClose, insertClose, listCloses, listEntriesForReports, stampCloseEmailSent } from "@/lib/db/bookkeeping"
import { isClosablePeriod, monthBounds, snapshotTotals } from "@/lib/bookkeeping/period-close"
import { closePeriodSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import { getSetting } from "@/lib/db/system-settings"
import { sendBooksClosedEmail } from "@/lib/bookkeeping/email-close"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const bookId = new URL(request.url).searchParams.get("book_id") ?? undefined
    const closes = await listCloses(bookId)
    return NextResponse.json({ closes })
  } catch (error) {
    console.error("List period closes error:", error)
    return NextResponse.json({ error: "Failed to load closes" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const parsed = closePeriodSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { book_id, period } = parsed.data

    const book = await getBook(book_id)
    if (!book) return NextResponse.json({ error: "book not found" }, { status: 404 })

    // D-7: any month strictly before the current UTC calendar month.
    if (!isClosablePeriod(period, new Date().toISOString().slice(0, 10))) {
      return NextResponse.json({ error: "Only complete past months can be closed." }, { status: 422 })
    }
    const existing = await getClose(book_id, period)
    if (existing) return NextResponse.json({ error: "That month is already closed for this book." }, { status: 409 })
    // (DB plain UNIQUE (book_id, period) is the race backstop.)

    const { from, to } = monthBounds(period)
    const entries = await listEntriesForReports(from, to, book_id)
    const totals = snapshotTotals(entries)
    const close = await insertClose({ book_id, period, closed_by: session.user.id, ...totals })

    void recordAudit({
      action: "bookkeeping.period_closed", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_period_close", id: close.id },
      metadata: { book_id, period, ...totals }, request,
    })

    // D-15: fire-and-forget AFTER the row persists — email failure never
    // fails the close. Flag default OFF; recipient = stored accountant
    // (cc coach inside sendBooksClosedEmail) else the coach alone.
    const emailEnabled = await getSetting<boolean>("bookkeeping_close_email_enabled", false)
    if (emailEnabled) {
      void (async () => {
        try {
          // String(x ?? "") junk-defense (house style): getSetting returns raw
          // jsonb, so a null/non-string stored value would otherwise throw
          // .trim() on undefined. 00187 seeds '""'::jsonb so this is a belt-
          // and-suspenders guard, not a currently-reachable path.
          const accountant = String((await getSetting<string>("bookkeeping_accountant_email", "")) ?? "").trim()
          const recipient = accountant !== "" ? accountant : (process.env.COACH_EMAIL ?? "")
          if (!recipient) throw new Error("no recipient configured (accountant email and COACH_EMAIL both empty)")
          const { error } = await sendBooksClosedEmail({
            recipient, bookName: book.name, period,
            income_cents: totals.income_cents, expense_cents: totals.expense_cents,
            net_cents: totals.net_cents, entry_count: totals.entry_count,
            closed_at: close.closed_at,
          })
          if (error) throw new Error(error)
          await stampCloseEmailSent(close.id)
          void recordAudit({
            action: "bookkeeping.close_emailed", category: "commerce", outcome: "success",
            target: { type: "bookkeeping_period_close", id: close.id },
            metadata: { book_id, period, recipient },
          })
        } catch (err) {
          void recordAudit({
            action: "bookkeeping.close_emailed", category: "commerce", outcome: "failure",
            target: { type: "bookkeeping_period_close", id: close.id },
            metadata: { book_id, period, error: (err as Error).message },
          })
        }
      })()
    }

    return NextResponse.json({ close }, { status: 201 })
  } catch (error) {
    console.error("Close period error:", error)
    return NextResponse.json({ error: "Failed to close the month" }, { status: 500 })
  }
}
