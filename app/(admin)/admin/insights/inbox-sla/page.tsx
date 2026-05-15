import { requireAdmin } from "@/lib/auth-helpers"
import { createServiceRoleClient } from "@/lib/supabase"
import { latestInboxSnapshot, listRecentInboxSnapshots } from "@/lib/db/inbox-sla"
import { InboxSlaCard } from "@/components/admin/insights/InboxSlaCard"

export const metadata = { title: "Inbox SLA | Insights | Admin" }
export const dynamic = "force-dynamic"

export default async function InboxSlaPage() {
  await requireAdmin()
  const supabase = createServiceRoleClient()
  const [latest, history] = await Promise.all([
    latestInboxSnapshot(supabase),
    listRecentInboxSnapshots(supabase, 14),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Inbox SLA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          GHL conversation health — refreshed by <code>inboxSlaCron</code> Mon–Fri 06:00 UTC.
          Aggregator at <code>lib/automation/inbox-sla-aggregator.ts</code>. Toggle via{" "}
          <code>cron_inbox_sla_enabled</code> in /admin/automation. Surfaces in Daily Pulse when
          there's something to flag.
        </p>
      </div>
      <InboxSlaCard latest={latest} history={history} />
    </div>
  )
}
