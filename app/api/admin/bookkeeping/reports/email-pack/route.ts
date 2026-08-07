import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { emailPackSchema } from "@/lib/validators/bookkeeping"
import { getSetting, setSetting } from "@/lib/db/system-settings"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments, listAssets } from "@/lib/db/bookkeeping"
import { buildAccountantPack } from "@/lib/bookkeeping/accountant-pack"
import { stripeFeeWindow } from "@/lib/bookkeeping/payout-fees"
import { sendAccountantPack } from "@/lib/bookkeeping/email-pack"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    const enabled = await getSetting<boolean>("bookkeeping_email_pack_enabled", false)
    if (!enabled) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const parsed = emailPackSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { from, to, recipient_email, remember } = parsed.data

    const [bundle, documents, assets] = await Promise.all([loadReportBundle(from, to), listAllDocuments(), listAssets()])
    const { books, accounts, entries } = bundle
    const buffer = await buildAccountantPack({
      from, to, books, accounts, entries, documents, assets,
      stripe_fees: stripeFeeWindow(bundle.payoutLines ?? [], bundle.payouts ?? [], from, to),
    })

    const { error } = await sendAccountantPack({ recipient: recipient_email, from, to, buffer })
    if (error) {
      void recordAudit({
        action: "bookkeeping.report_emailed", category: "commerce", outcome: "failure",
        metadata: { recipient_email, from, to, error }, request,
      })
      return NextResponse.json({ error: "Failed to send" }, { status: 502 })
    }

    if (remember) await setSetting("bookkeeping_accountant_email", recipient_email, session.user.id)

    void recordAudit({
      action: "bookkeeping.report_emailed", category: "commerce", outcome: "success",
      metadata: { recipient_email, from, to, entry_count: entries.length, trigger: "manual" }, request,
    })
    return NextResponse.json({ ok: true, sentTo: recipient_email })
  } catch (error) {
    console.error("Email accountant pack error:", error)
    return NextResponse.json({ error: "Failed to email accountant pack" }, { status: 500 })
  }
}
