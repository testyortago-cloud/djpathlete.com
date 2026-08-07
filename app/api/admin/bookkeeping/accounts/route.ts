import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listAccounts, createAccount } from "@/lib/db/bookkeeping"
import { createAccountSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

async function gate() {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) return null
  return session
}

export async function GET(request: Request) {
  try {
    if (!(await gate())) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const bookId = new URL(request.url).searchParams.get("book_id")
    if (!bookId) return NextResponse.json({ error: "book_id required" }, { status: 400 })
    const accounts = await listAccounts(bookId)
    return NextResponse.json({ accounts })
  } catch (error) {
    console.error("List bookkeeping accounts error:", error)
    return NextResponse.json({ error: "Failed to load accounts" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    if (!(await gate())) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const body = await request.json().catch(() => null)
    const parsed = createAccountSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const account = await createAccount(parsed.data)
    void recordAudit({ action: "bookkeeping.account_created", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_account", id: account.id, label: account.name }, request })
    return NextResponse.json({ account }, { status: 201 })
  } catch (error) {
    console.error("Create bookkeeping account error:", error)
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 })
  }
}
