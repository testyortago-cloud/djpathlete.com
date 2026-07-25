import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { reportQuerySchema } from "@/lib/validators/bookkeeping"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments, listAssets } from "@/lib/db/bookkeeping"
import { buildAccountantPack } from "@/lib/bookkeeping/accountant-pack"
import { stripeFeesInWindow } from "@/lib/bookkeeping/payout-fees"
import { recordAudit } from "@/lib/audit/record"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    const sp = new URL(request.url).searchParams
    const parsed = reportQuerySchema.safeParse({ from: sp.get("from"), to: sp.get("to") })
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { from, to } = parsed.data

    const [bundle, documents, assets] = await Promise.all([loadReportBundle(from, to), listAllDocuments(), listAssets()])
    const { books, accounts, entries } = bundle
    const buf = await buildAccountantPack({
      from, to, books, accounts, entries, documents, assets,
      // ?? [] tolerates pre-payoutLines bundle doubles; the real bundle always supplies it.
      stripe_fee_cents: stripeFeesInWindow(bundle.payoutLines ?? [], from, to),
    })

    void recordAudit({
      action: "bookkeeping.report_exported", category: "admin_read_sensitive", outcome: "success",
      metadata: { format: "accountant_pack_xlsx", from, to, entry_count: entries.length, document_count: documents.length }, request,
    })
    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="djp-accountant-pack-${from}-${to}.xlsx"`,
        "cache-control": "no-store",
      },
    })
  } catch (error) {
    console.error("Accountant pack export error:", error)
    return NextResponse.json({ error: "Failed to build accountant pack" }, { status: 500 })
  }
}
