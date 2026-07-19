import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listAssets, createAsset, getBook } from "@/lib/db/bookkeeping"
import { createAssetSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const bookId = new URL(request.url).searchParams.get("book_id")
    if (!bookId) return NextResponse.json({ error: "book_id required" }, { status: 400 })
    const assets = await listAssets(bookId)
    return NextResponse.json({ assets })
  } catch (error) {
    console.error("List bookkeeping assets error:", error)
    return NextResponse.json({ error: "Failed to load assets" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const body = await request.json().catch(() => null)
    const parsed = createAssetSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const book = await getBook(parsed.data.book_id)
    if (!book) return NextResponse.json({ error: "book not found" }, { status: 404 })
    const asset = await createAsset({ ...parsed.data, accountant_note: parsed.data.accountant_note ?? null })
    void recordAudit({ action: "bookkeeping.asset_created", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_asset", id: asset.id, label: asset.name },
      metadata: { book_id: asset.book_id, basis_cents: asset.basis_cents, method: asset.method, convention: asset.convention, recovery_years: asset.recovery_years },
      request })
    return NextResponse.json({ asset }, { status: 201 })
  } catch (error) {
    console.error("Create bookkeeping asset error:", error)
    return NextResponse.json({ error: "Failed to create asset" }, { status: 500 })
  }
}
