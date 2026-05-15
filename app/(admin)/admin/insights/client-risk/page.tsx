import { requireAdmin } from "@/lib/auth-helpers"
import { createServiceRoleClient } from "@/lib/supabase"
import {
  ClientRiskTable,
  type ClientRiskTableRow,
} from "@/components/admin/insights/ClientRiskTable"
import type { ClientEngagementSnapshot } from "@/types/database"

export const metadata = { title: "Client Risk | Insights | Admin" }
export const dynamic = "force-dynamic"

interface RawRow extends ClientEngagementSnapshot {
  users: { first_name: string | null; last_name: string | null; email: string } | null
}

function formatName(row: RawRow): string {
  const first = row.users?.first_name?.trim() ?? ""
  const last = row.users?.last_name?.trim() ?? ""
  return `${first} ${last}`.trim() || row.users?.email || "Unknown"
}

export default async function ClientRiskInsightsPage() {
  await requireAdmin()

  // Service role: the snapshots table has RLS on and only admins/service-role
  // can read it. The page itself is gated by requireAdmin above.
  const supabase = createServiceRoleClient()

  // Pull the most recent snapshot_date (might not be today if the cron hasn't
  // run today — show whatever's freshest).
  const { data: latestDateRow } = await supabase
    .from("client_engagement_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  const latestDate = latestDateRow?.snapshot_date as string | undefined

  let rows: ClientRiskTableRow[] = []
  if (latestDate) {
    const { data } = await supabase
      .from("client_engagement_snapshots")
      .select("*, users:client_id (first_name, last_name, email)")
      .eq("snapshot_date", latestDate)
      .order("risk_score", { ascending: false })

    rows = ((data ?? []) as RawRow[]).map((row) => ({
      ...row,
      client_name: formatName(row),
      client_email: row.users?.email ?? "",
    }))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Client Risk</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Daily snapshot — refreshed by <code>clientRiskScanCron</code> at 05:00 UTC. The
          weighted-signal rubric lives in{" "}
          <code>lib/automation/client-risk-scorer.ts</code>. Toggle the cron on/off via{" "}
          <code>cron_client_risk_scan_enabled</code> in /admin/automation.
        </p>
        {latestDate ? (
          <p className="text-xs text-muted-foreground mt-2">
            Snapshot date: <span className="font-mono">{latestDate}</span> · {rows.length}{" "}
            clients
          </p>
        ) : (
          <p className="text-xs text-muted-foreground mt-2">
            No snapshots yet — flip the flag on or trigger the route manually.
          </p>
        )}
      </div>

      <ClientRiskTable rows={rows} />
    </div>
  )
}
