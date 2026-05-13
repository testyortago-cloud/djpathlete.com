import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/lib/auth"
import { getGscProperty } from "@/lib/db/gsc-properties"
import { getSetting } from "@/lib/db/system-settings"
import { getGscStats, getRecentTopRows } from "@/lib/db/gsc-query-daily"
import { Button } from "@/components/ui/button"

export const dynamic = "force-dynamic"

const WARM_UP_TARGET = 28

function formatRelative(iso: string | null): string {
  if (!iso) return "never"
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default async function GscIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>
}) {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    redirect("/login?callbackUrl=/admin/integrations/gsc")
  }
  const params = await searchParams

  const [property, oauthBroken] = await Promise.all([
    getGscProperty(),
    getSetting<boolean>("gsc_oauth_broken", false),
  ])

  // Don't fetch stats unless connected.
  const [stats, recentRows] = property
    ? await Promise.all([getGscStats(), getRecentTopRows(10)])
    : [
        { totalRows: 0, distinctDates: 0, latestDateWithData: null, lastIngestAt: null },
        [],
      ]

  const warmUpPct = Math.min(100, Math.round((stats.distinctDates / WARM_UP_TARGET) * 100))

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="font-heading text-3xl text-primary">Google Search Console</h1>
        <p className="text-muted-foreground">
          Connect Search Console so the SEO agent can read query performance.
        </p>
      </header>

      {params.connected && (
        <div className="rounded-md border border-success/40 bg-success/10 p-4 text-sm">
          Connected. The first sync will run on the next scheduled cron (03:15 UTC daily).
        </div>
      )}
      {params.error && (
        <div className="rounded-md border border-error/40 bg-error/10 p-4 text-sm">
          Connection failed: <code>{params.error}</code>. Try again or check that you have
          site-owner access.
        </div>
      )}
      {oauthBroken && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm">
          Search Console returned an auth error on the last sync. Reconnect to refresh tokens.
        </div>
      )}

      <section className="rounded-md border bg-surface p-4">
        {property ? (
          <div className="space-y-4">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Connected site</div>
              <div className="font-mono">{property.site_url}</div>
            </div>

            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Total rows</dt>
                <dd className="text-xl font-medium">{stats.totalRows.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">
                  Days of data ({stats.distinctDates}/{WARM_UP_TARGET})
                </dt>
                <dd className="text-xl font-medium">
                  {warmUpPct}
                  <span className="text-xs text-muted-foreground">%</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Latest date</dt>
                <dd className="text-xl font-medium">
                  {stats.latestDateWithData ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Last sync</dt>
                <dd className="text-xl font-medium">{formatRelative(stats.lastIngestAt)}</dd>
              </div>
            </dl>

            <p className="text-xs text-muted-foreground">
              The SEO agent stays idle until <code>distinctDates ≥ {WARM_UP_TARGET}</code>.
              GSC has a 2–4 day reporting lag, so the most recent days will lag the
              calendar.{" "}
              <Link href="/admin/automation" className="text-primary underline">
                Manage cron toggles
              </Link>
            </p>

            <form action="/api/admin/integrations/gsc/disconnect" method="post">
              <Button type="submit" variant="destructive">
                Disconnect
              </Button>
            </form>
          </div>
        ) : (
          <Button asChild>
            <Link href="/api/admin/integrations/gsc/authorize">
              Connect Google Search Console
            </Link>
          </Button>
        )}
      </section>

      {property && recentRows.length > 0 && (
        <section className="rounded-md border bg-white p-4">
          <h2 className="font-heading text-lg text-primary mb-3">
            Recent rows (top {recentRows.length} by impressions)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Query</th>
                  <th className="pb-2 pr-3">Page</th>
                  <th className="pb-2 pr-3 text-right">Impr.</th>
                  <th className="pb-2 pr-3 text-right">Clicks</th>
                  <th className="pb-2 text-right">Position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentRows.map((r, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3 font-mono text-xs">{r.date}</td>
                    <td className="py-2 pr-3">{r.query}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground truncate max-w-[200px]">
                      {r.page.replace(/^https?:\/\/[^/]+/, "")}
                    </td>
                    <td className="py-2 pr-3 text-right">{r.impressions}</td>
                    <td className="py-2 pr-3 text-right">{r.clicks}</td>
                    <td className="py-2 text-right font-mono">{Number(r.position).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {property && recentRows.length === 0 && (
        <section className="rounded-md border bg-surface p-6 text-center text-sm text-muted-foreground">
          No rows synced yet. The first nightly sync runs at 03:15 UTC. Or trigger a manual
          run from{" "}
          <Link href="/admin/automation" className="text-primary underline">
            /admin/automation
          </Link>
          .
        </section>
      )}
    </div>
  )
}
