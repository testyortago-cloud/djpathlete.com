import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/lib/auth"
import { getGscProperty } from "@/lib/db/gsc-properties"
import { getSetting } from "@/lib/db/system-settings"
import { countRowsForDate } from "@/lib/db/gsc-query-daily"
import { Button } from "@/components/ui/button"

export const dynamic = "force-dynamic"

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

  const yesterday = (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  })()
  const lastSyncRowCount = property ? await countRowsForDate(yesterday) : 0

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="font-heading text-3xl text-primary">Google Search Console</h1>
        <p className="text-muted-foreground">
          Connect Search Console so the SEO agent can read query performance.
        </p>
      </header>

      {params.connected && (
        <div className="rounded-md border border-success/40 bg-success/10 p-4 text-sm">
          Connected. The first sync will run on the next scheduled cron (03:00 UTC daily).
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
          <div className="space-y-3">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Connected site</div>
              <div className="font-mono">{property.site_url}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Yesterday&apos;s row count</div>
              <div>{lastSyncRowCount.toLocaleString()}</div>
            </div>
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
    </div>
  )
}
