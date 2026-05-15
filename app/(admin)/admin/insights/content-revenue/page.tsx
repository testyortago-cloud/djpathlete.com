import { requireAdmin } from "@/lib/auth-helpers"
import { createServiceRoleClient } from "@/lib/supabase"
import { topByRevenue } from "@/lib/db/content-attribution"
import { ContentRevenueTable } from "@/components/admin/insights/ContentRevenueTable"

export const metadata = { title: "Content Revenue | Insights | Admin" }
export const dynamic = "force-dynamic"

export default async function ContentRevenuePage() {
  await requireAdmin()
  const supabase = createServiceRoleClient()
  const rows = await topByRevenue(supabase, 4, 20)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Content → Revenue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Top posts by revenue, last 4 weeks. First-touch-landing attribution joins{" "}
          <code>blog_posts</code> × <code>gsc_query_daily</code> ×{" "}
          <code>marketing_attribution</code> × <code>payments</code>. Refreshed by{" "}
          <code>contentAttributionCron</code> at 22:00 UTC Sunday. Toggle via{" "}
          <code>cron_content_attribution_enabled</code> in /admin/automation.
        </p>
      </div>
      <ContentRevenueTable rows={rows} />
    </div>
  )
}
