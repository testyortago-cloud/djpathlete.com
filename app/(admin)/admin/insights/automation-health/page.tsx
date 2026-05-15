import { requireAdmin } from "@/lib/auth-helpers"
import { createServiceRoleClient } from "@/lib/supabase"
import { lastSuccessPerCron } from "@/lib/db/cron-runs"
import { EXPECTED_CRONS } from "@/lib/automation/automation-health-scanner"
import {
  AutomationHealthBoard,
  type HealthSnapshot,
} from "@/components/admin/insights/AutomationHealthBoard"

export const metadata = { title: "Automation Health | Insights | Admin" }
export const dynamic = "force-dynamic"

export default async function AutomationHealthPage() {
  await requireAdmin()
  const supabase = createServiceRoleClient()

  const [{ data: snapshotsRaw }, lastSuccessByCron] = await Promise.all([
    supabase
      .from("automation_health_snapshots")
      .select("*")
      .order("snapshot_at", { ascending: false })
      .limit(14),
    lastSuccessPerCron(
      supabase,
      EXPECTED_CRONS.map((c) => c.name),
    ),
  ])

  const snapshots = (snapshotsRaw ?? []) as HealthSnapshot[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Automation Health</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Daily watchdog — refreshed by <code>automationHealthCron</code> at 08:00 UTC. Scans
          Firestore <code>ai_jobs</code> + Supabase <code>cron_runs</code>. Per-cron SLAs live in{" "}
          <code>lib/automation/automation-health-scanner.ts</code>. Toggle via{" "}
          <code>cron_automation_health_enabled</code> in /admin/automation.
        </p>
      </div>
      <AutomationHealthBoard snapshots={snapshots} lastSuccessByCron={lastSuccessByCron} />
    </div>
  )
}
