import { requireAdmin } from "@/lib/auth-helpers"
import { listAuditLogs } from "@/lib/db/audit-logs"
import { AuditLogFilters } from "@/components/admin/audit-log-filters"
import { AuditLogTable } from "@/components/admin/audit-log-table"
import type { AuditCategory, AuditOutcome } from "@/lib/audit/types"

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AuditLogsPage({ searchParams }: PageProps) {
  await requireAdmin()
  const sp = await searchParams
  const str = (v: string | string[] | undefined): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined
  const page = Number.parseInt(str(sp.page) ?? "1", 10) || 1
  const perPage = 50

  const { rows, total } = await listAuditLogs({
    category: str(sp.category) as AuditCategory | undefined,
    outcome: str(sp.outcome) as AuditOutcome | undefined,
    action: str(sp.action),
    actor_id: str(sp.actor_id),
    target_type: str(sp.target_type),
    target_id: str(sp.target_id),
    from: str(sp.from),
    to: str(sp.to),
    q: str(sp.q),
    page,
    perPage,
  })

  // 24h failure count for alert strip
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { total: failures24h } = await listAuditLogs({
    outcome: "failure",
    from: since24h,
    page: 1,
    perPage: 1,
  })

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-primary">Audit Logs</h1>
          <p className="text-muted-foreground text-sm">
            Append-only log of every mutation, auth event, and automation run.
          </p>
        </div>
        {failures24h > 0 && (
          <a
            href="/admin/audit-logs?outcome=failure"
            className="bg-error/10 text-error rounded-md px-3 py-1.5 text-sm font-medium"
          >
            {failures24h} failure(s) in last 24h
          </a>
        )}
      </header>

      <AuditLogFilters />
      <AuditLogTable rows={rows} total={total} page={page} perPage={perPage} />
    </div>
  )
}
