import {
  ga4IsConfigured,
  getGa4ServiceAccountEmail,
  getOverviewMetrics,
  getTrafficByChannel,
  getTopPages,
  getTopEvents,
  type Ga4ChannelRow,
  type Ga4OverviewMetrics,
  type Ga4PageRow,
  type Ga4EventRow,
} from "@/lib/analytics/ga4-data"

export const metadata = { title: "GA4 — Overview" }
export const dynamic = "force-dynamic"
export const revalidate = 0

const RANGE = { startDate: "28daysAgo", endDate: "today" } as const

export default async function Ga4OverviewPage() {
  const configured = ga4IsConfigured()

  let overview: Ga4OverviewMetrics | null = null
  let channels: Ga4ChannelRow[] = []
  let pages: Ga4PageRow[] = []
  let events: Ga4EventRow[] = []
  let fetchError: string | null = null

  if (configured) {
    try {
      const [o, c, p, e] = await Promise.all([
        getOverviewMetrics(RANGE),
        getTrafficByChannel(RANGE, 10),
        getTopPages(RANGE, 15),
        getTopEvents(RANGE, 15),
      ])
      overview = o
      channels = c
      pages = p
      events = e
    } catch (err) {
      fetchError =
        err instanceof Error ? err.message : "Failed to fetch GA4 reports."
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-heading text-primary">GA4 Overview</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Pulled live from the Google Analytics Data API for property{" "}
          <code className="font-mono text-xs">{process.env.GA4_PROPERTY_ID ?? "—"}</code>.
          Last 28 days. Reports are read-only mirrors of GA4 — no data is stored locally.
        </p>
      </header>

      <WiringCheck configured={configured} fetchOk={!fetchError} />

      {!configured ? <SetupChecklist /> : null}

      {fetchError ? (
        <div className="border border-error/40 bg-error/5 text-error rounded-lg p-4 text-sm">
          <p className="font-medium">GA4 fetch failed.</p>
          <p className="text-xs mt-1 font-mono opacity-90">{fetchError}</p>
          <p className="text-xs mt-2 opacity-90">
            Common causes: service account not granted Viewer access to the property, wrong{" "}
            <code className="font-mono">GA4_PROPERTY_ID</code>, or Data API not enabled in the
            Cloud project.
          </p>
        </div>
      ) : null}

      {overview ? (
        <section>
          <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
            ─ Overview
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Tile label="Sessions" value={overview.sessions} tone="bg-primary/10 text-primary" />
            <Tile label="Total users" value={overview.totalUsers} tone="bg-accent/10 text-accent" />
            <Tile label="New users" value={overview.newUsers} tone="bg-success/10 text-success" />
            <Tile
              label="Engaged sessions"
              value={overview.engagedSessions}
              tone="bg-primary/10 text-primary"
            />
            <Tile
              label="Avg. session"
              value={`${Math.round(overview.averageSessionDurationSec)}s`}
              tone="bg-muted/40 text-muted-foreground"
            />
            <Tile
              label="Conversions"
              value={overview.conversions}
              tone="bg-warning/15 text-warning"
            />
          </div>
        </section>
      ) : null}

      {channels.length > 0 ? (
        <section>
          <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
            ─ Traffic by channel
          </h2>
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Channel</th>
                  <th className="text-right p-3 w-28">Sessions</th>
                  <th className="text-right p-3 w-28">Users</th>
                  <th className="text-right p-3 w-28">Conversions</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.channel} className="border-t border-border/60">
                    <td className="p-3 font-medium text-primary">{c.channel}</td>
                    <td className="p-3 text-right font-mono text-xs">
                      {c.sessions.toLocaleString()}
                    </td>
                    <td className="p-3 text-right font-mono text-xs">
                      {c.totalUsers.toLocaleString()}
                    </td>
                    <td className="p-3 text-right font-mono text-xs">
                      {c.conversions.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {pages.length > 0 ? (
        <section>
          <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
            ─ Top pages
          </h2>
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Path</th>
                  <th className="text-right p-3 w-24">Views</th>
                  <th className="text-right p-3 w-24">Users</th>
                  <th className="text-right p-3 w-28">Avg engagement</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.path} className="border-t border-border/60 align-top">
                    <td className="p-3">
                      <p className="font-mono text-xs text-primary leading-snug">{p.path}</p>
                      {p.title ? (
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                          {p.title.slice(0, 200)}
                        </p>
                      ) : null}
                    </td>
                    <td className="p-3 text-right font-mono text-xs">
                      {p.views.toLocaleString()}
                    </td>
                    <td className="p-3 text-right font-mono text-xs">
                      {p.users.toLocaleString()}
                    </td>
                    <td className="p-3 text-right font-mono text-xs">
                      {Math.round(p.averageEngagementTimeSec)}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {events.length > 0 ? (
        <section>
          <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
            ─ Top events
          </h2>
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Event</th>
                  <th className="text-right p-3 w-28">Count</th>
                  <th className="text-right p-3 w-28">Users</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.eventName} className="border-t border-border/60">
                    <td className="p-3 font-mono text-xs text-primary">{e.eventName}</td>
                    <td className="p-3 text-right font-mono text-xs">
                      {e.count.toLocaleString()}
                    </td>
                    <td className="p-3 text-right font-mono text-xs">
                      {e.users.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone: string
}) {
  const display = typeof value === "number" ? value.toLocaleString() : value
  return (
    <div className={`rounded-xl border border-border p-4 ${tone}`}>
      <p className="text-[11px] font-mono uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-2xl font-heading mt-1">{display}</p>
    </div>
  )
}

function WiringCheck({ configured, fetchOk }: { configured: boolean; fetchOk: boolean }) {
  const propertyId = process.env.GA4_PROPERTY_ID ?? null
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? null
  const serviceAccount = getGa4ServiceAccountEmail()

  const rows: Array<{ label: string; value: string | null; ok: boolean; hint?: string }> = [
    {
      label: "Server property",
      value: propertyId,
      ok: Boolean(propertyId),
      hint: "GA4_PROPERTY_ID — used by the Data API",
    },
    {
      label: "Client tag",
      value: measurementId,
      ok: Boolean(measurementId && measurementId.startsWith("G-")),
      hint: "NEXT_PUBLIC_GA_MEASUREMENT_ID — injected on every page",
    },
    {
      label: "Service account",
      value: serviceAccount,
      ok: Boolean(serviceAccount),
      hint: "Must be Viewer on the property in GA4 Admin",
    },
    {
      label: "Data API live",
      value: configured && fetchOk ? "OK" : configured ? "Auth/permission error" : "Not configured",
      ok: configured && fetchOk,
      hint: "Latest report fetch result",
    },
  ]

  return (
    <section>
      <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
        ─ Wiring check
      </h2>
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-border/60 first:border-t-0">
                <td className="p-3 w-44 align-top">
                  <p className="font-medium text-primary">{r.label}</p>
                  {r.hint ? (
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{r.hint}</p>
                  ) : null}
                </td>
                <td className="p-3 align-top">
                  <code className="font-mono text-xs break-all">{r.value ?? "—"}</code>
                </td>
                <td className="p-3 w-24 text-right align-top">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wider ${
                      r.ok
                        ? "bg-success/10 text-success"
                        : "bg-error/10 text-error"
                    }`}
                  >
                    {r.ok ? "OK" : "Check"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SetupChecklist() {
  return (
    <div className="border border-warning/40 bg-warning/5 text-warning rounded-lg p-4 text-sm space-y-3">
      <p className="font-medium">GA4 Data API not configured.</p>
      <ol className="list-decimal list-inside space-y-1 text-xs opacity-90">
        <li>
          Google Cloud Console → enable <span className="font-mono">Google Analytics Data API</span>.
        </li>
        <li>
          IAM &amp; Admin → Service Accounts → create one (no project roles needed). Keys → Add key
          → JSON → download.
        </li>
        <li>
          GA4 → Admin → Property access management → add the service-account email as{" "}
          <strong>Viewer</strong> on property <code className="font-mono">533252977</code>.
        </li>
        <li>
          Set envs:
          <pre className="mt-1 p-2 rounded bg-card text-foreground font-mono text-[11px] whitespace-pre-wrap">{`GA4_PROPERTY_ID=533252977
GA4_SERVICE_ACCOUNT_JSON=<base64 of the JSON key>`}</pre>
          (base64 keeps it on one line for Vercel envs.)
        </li>
      </ol>
    </div>
  )
}
