import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listDocuments } from "@/lib/db/bookkeeping"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const sp = new URL(request.url).searchParams
    const bookId = sp.get("book_id")
    if (!bookId) return NextResponse.json({ error: "book_id required" }, { status: 400 })
    const documents = await listDocuments(bookId)
    return NextResponse.json({ documents })
  } catch (error) {
    console.error("List bookkeeping documents error:", error)
    return NextResponse.json({ error: "Failed to load documents" }, { status: 500 })
  }
}
