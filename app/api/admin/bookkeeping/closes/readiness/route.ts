// GET /api/admin/bookkeeping/closes/readiness?book_id=&period=
// Read-only pre-close check. Unaudited (a read of state the coach already owns),
// same shape the close POST enforces — see close-readiness-server.ts.
// Static segment: Next resolves this before closes/[id], which only has DELETE.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBook } from "@/lib/db/bookkeeping"
import { gatherCloseReadiness } from "@/lib/bookkeeping/close-readiness-server"
import { closePeriodSchema } from "@/lib/validators/bookkeeping"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin")
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    const params = new URL(request.url).searchParams
    const parsed = closePeriodSchema.safeParse({
      book_id: params.get("book_id") ?? undefined,
      period: params.get("period") ?? undefined,
    })
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { book_id, period } = parsed.data

    const book = await getBook(book_id)
    if (!book) return NextResponse.json({ error: "book not found" }, { status: 404 })

    const readiness = await gatherCloseReadiness(book_id, period, new Date().toISOString().slice(0, 10))
    return NextResponse.json({ readiness })
  } catch (error) {
    console.error("Close readiness error:", error)
    return NextResponse.json({ error: "Failed to check readiness" }, { status: 500 })
  }
}
