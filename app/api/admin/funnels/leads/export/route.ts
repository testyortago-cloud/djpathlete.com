// app/api/admin/funnels/leads/export/route.ts — the leads, as a CSV download.
//
// Audited under `admin_read_sensitive`, not `admin_write`. Nothing is modified,
// and that is exactly why it belongs in the trail: this endpoint takes every
// lead's name, email and phone number out of the system in one file. A read
// that exfiltrates is more worth recording than most writes.
//
// It honours the SAME filters as the screen, parsed the same way, so "export"
// means "export what I am looking at". An export that quietly ignored the
// filters would hand over the whole table to someone who asked for last week.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { recordAudit } from "@/lib/audit/record"
import { listLeadsForExport, type LeadFilters } from "@/lib/db/funnel-leads"
import { leadsCsvFilename, leadsToCsv } from "@/lib/funnels/leads-csv"
import { FUNNEL_LEAD_STATUSES, type FunnelLeadStatus } from "@/types/database"

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const params = new URL(request.url).searchParams
  const statusParam = params.get("status") ?? ""
  const days = params.get("days") ?? ""
  const search = params.get("search") ?? ""
  const funnelId = params.get("funnelId") ?? ""

  const status = (FUNNEL_LEAD_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as FunnelLeadStatus)
    : undefined
  const dayCount = /^\d{1,4}$/.test(days) ? Number(days) : undefined

  const filters: LeadFilters = {
    funnelId: funnelId || undefined,
    status,
    since: dayCount ? new Date(Date.now() - dayCount * 86_400_000).toISOString() : undefined,
    search: search || undefined,
  }

  try {
    const leads = await listLeadsForExport(filters)

    recordAudit({
      action: "funnel.leads_exported",
      category: "admin_read_sensitive",
      outcome: "success",
      metadata: { rows: leads.length, funnel_id: funnelId || null, status: status ?? null, days: dayCount ?? null },
    })

    return new NextResponse(leadsToCsv(leads), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${leadsCsvFilename(new Date())}"`,
        // A file of customer contact details must not sit in a shared cache.
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("[GET /api/admin/funnels/leads/export]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
