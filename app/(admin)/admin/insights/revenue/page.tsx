import { requireAdmin } from "@/lib/auth-helpers"
import { createServiceRoleClient } from "@/lib/supabase"
import { listRecentSnapshots } from "@/lib/db/revenue-snapshots"
import { RevenueDigestCard } from "@/components/admin/insights/RevenueDigestCard"

export const metadata = { title: "Revenue | Insights | Admin" }
export const dynamic = "force-dynamic"

export default async function RevenueInsightsPage() {
  await requireAdmin()
  const supabase = createServiceRoleClient()
  const snapshots = await listRecentSnapshots(supabase, 12)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Revenue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Weekly digest — refreshed by <code>revenueDigestCron</code> at 13:00 UTC Monday. MRR
          aggregator lives in <code>lib/automation/revenue-aggregator.ts</code>; data sources in{" "}
          <code>lib/db/revenue-snapshots.ts</code>. Toggle via{" "}
          <code>cron_revenue_digest_enabled</code> in /admin/automation.
        </p>
      </div>
      <RevenueDigestCard snapshots={snapshots} />
    </div>
  )
}
