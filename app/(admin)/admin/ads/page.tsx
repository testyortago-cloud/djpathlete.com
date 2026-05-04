import Link from "next/link"
import {
  Target,
  ShieldCheck,
  Settings,
  BarChart3,
  Sparkles,
  Bot,
  LineChart,
  TrendingUp,
  Layers,
  Users,
  ClipboardCheck,
} from "lucide-react"
import { createServiceRoleClient } from "@/lib/supabase"
import { listGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import { listAllCampaigns } from "@/lib/db/google-ads-campaigns"
import { getCampaignRollup } from "@/lib/db/google-ads-metrics"
import {
  listRecommendations,
  getRecommendationStatusCounts,
} from "@/lib/db/google-ads-recommendations"
import { getConversionUploadStatusCounts } from "@/lib/db/google-ads-conversion-uploads"
import { listAgentMemos } from "@/lib/db/google-ads-agent-memos"
import {
  buildPipelineFunnelWithComparison,
  computeRates,
} from "@/lib/ads/pipeline"
import type { GoogleAdsRecommendation, GoogleAdsRecommendationType } from "@/types/database"

export const metadata = { title: "Google Ads" }
export const dynamic = "force-dynamic"

function isoDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
}

function fmtNumber(n: number): string {
  if (n === 0) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString("en-US")
}

function fmtMoney(micros: number, currency = "USD"): string {
  if (micros === 0) return "—"
  const dollars = micros / 1_000_000
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K ${currency}`
  return `$${dollars.toFixed(2)} ${currency}`
}

function fmtRevenue(cents: number): string {
  if (cents === 0) return "—"
  const dollars = cents / 100
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`
  return `$${dollars.toFixed(2)}`
}

function fmtPct(rate: number): string {
  if (rate === 0) return "—"
  return `${(rate * 100).toFixed(1)}%`
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return "just now"
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

const REC_TYPE_LABEL: Record<GoogleAdsRecommendationType, string> = {
  add_negative_keyword: "Add negative kw",
  adjust_bid: "Adjust bid",
  pause_keyword: "Pause keyword",
  add_keyword: "Add keyword",
  add_ad_variant: "New ad variant",
  pause_ad: "Pause ad",
}

function recSummary(rec: GoogleAdsRecommendation): string {
  const p = rec.payload as Record<string, unknown>
  switch (rec.recommendation_type) {
    case "add_negative_keyword":
    case "add_keyword":
      return `"${p.text}" [${p.match_type}]`
    case "adjust_bid": {
      const cur = Number(p.current_micros ?? 0) / 1_000_000
      const next = Number(p.proposed_micros ?? 0) / 1_000_000
      return `$${cur.toFixed(2)} → $${next.toFixed(2)}`
    }
    case "pause_keyword":
      return `criterion ${String(p.criterion_id ?? "?")}`
    case "add_ad_variant": {
      const h = Array.isArray(p.headlines) ? p.headlines.length : 0
      const d = Array.isArray(p.descriptions) ? p.descriptions.length : 0
      return `${h} headlines · ${d} descriptions`
    }
    case "pause_ad":
      return `ad ${String(p.ad_id ?? "?")}`
  }
}

function fmtDelta(pct: number | null): { label: string; tone: string } | null {
  if (pct === null || Number.isNaN(pct)) return null
  const rounded = Math.round(pct * 10) / 10
  if (rounded === 0) return { label: "no change", tone: "text-muted-foreground" }
  const sign = rounded > 0 ? "+" : ""
  return {
    label: `${sign}${rounded}% vs prev`,
    tone: rounded > 0 ? "text-success" : "text-error",
  }
}

export default async function AdsHomePage() {
  const supabase = createServiceRoleClient()

  const fromDate = isoDate(7)
  const toDate = isoDate(0)
  const rangeEnd = new Date()
  const rangeStart = new Date(rangeEnd.getTime() - 28 * 86_400_000)

  const [
    { data: connection },
    accounts,
    campaigns,
    recCounts,
    topRecs,
    uploadCounts,
    memos,
    funnel,
  ] = await Promise.all([
    supabase
      .from("platform_connections")
      .select("status, account_handle, updated_at")
      .eq("plugin_name", "google_ads")
      .maybeSingle(),
    listGoogleAdsAccounts(),
    listAllCampaigns(),
    getRecommendationStatusCounts(),
    listRecommendations({ status: "pending", limit: 3 }),
    getConversionUploadStatusCounts(),
    listAgentMemos(1),
    buildPipelineFunnelWithComparison({ rangeStart, rangeEnd }),
  ])

  const isConnected = (connection?.status ?? "not_connected") === "connected"
  const activeAccounts = accounts.filter((a) => a.is_active)
  const lastSynced =
    accounts
      .map((a) => a.last_synced_at)
      .filter((s): s is string => Boolean(s))
      .sort()
      .at(-1) ?? null
  const accountWithError = accounts.find((a) => a.last_error)

  // 7-day account totals across all customer IDs
  const totals = { spend_micros: 0, clicks: 0, conversions: 0, conversion_value: 0 }
  await Promise.all(
    activeAccounts.map(async (a) => {
      const map = await getCampaignRollup(a.customer_id, fromDate, toDate)
      for (const r of map.values()) {
        totals.spend_micros += r.cost_micros
        totals.clicks += r.clicks
        totals.conversions += r.conversions
        totals.conversion_value += r.conversion_value
      }
    }),
  )
  const enabledCampaigns = campaigns.filter((c) => c.status === "ENABLED").length
  const currency = activeAccounts[0]?.currency_code ?? "USD"

  const latestMemo = memos[0] ?? null
  const rates = computeRates(funnel.totals)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Target className="size-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-heading text-primary">Google Ads</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            AI-managed Google Ads with conversion feedback loops and a senior-marketer agent.
            Snapshot from the live account.
          </p>
        </div>
      </div>

      {/* Connection status banner */}
      <ConnectionBanner
        isConnected={isConnected}
        accountHandle={connection?.account_handle ?? null}
        activeCount={activeAccounts.length}
        lastSynced={lastSynced}
        errorMessage={accountWithError?.last_error ?? null}
      />

      {/* 7-day account totals */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            ─ Last 7 days · {activeAccounts.length} account{activeAccounts.length === 1 ? "" : "s"}
          </h2>
          <span className="text-[11px] font-mono text-muted-foreground">
            {enabledCampaigns} enabled / {campaigns.length} total campaigns
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile
            label="Spend"
            value={fmtMoney(totals.spend_micros, currency)}
            tone="bg-primary/10 text-primary"
          />
          <Tile label="Clicks" value={fmtNumber(totals.clicks)} tone="bg-accent/10 text-accent" />
          <Tile
            label="Conversions"
            value={fmtNumber(totals.conversions)}
            tone="bg-success/10 text-success"
          />
          <Tile
            label="Conv. value"
            value={fmtMoney(Math.round(totals.conversion_value * 1_000_000), currency)}
            tone="bg-warning/15 text-warning"
          />
        </div>
      </section>

      {/* Pipeline 28-day */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            ─ Pipeline · last 28 days
          </h2>
          <Link
            href="/admin/ads/pipeline"
            className="text-[11px] font-mono text-muted-foreground hover:text-accent"
          >
            View full funnel →
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Stat
            label="Visits"
            value={fmtNumber(funnel.totals.visits)}
            delta={funnel.deltaPct ? fmtDelta(funnel.deltaPct.visits) : null}
          />
          <Stat
            label="Signups"
            value={fmtNumber(funnel.totals.signups)}
            delta={funnel.deltaPct ? fmtDelta(funnel.deltaPct.signups) : null}
          />
          <Stat
            label="Bookings"
            value={fmtNumber(funnel.totals.bookings)}
            delta={funnel.deltaPct ? fmtDelta(funnel.deltaPct.bookings) : null}
          />
          <Stat
            label="Payments"
            value={fmtNumber(funnel.totals.payments)}
            delta={funnel.deltaPct ? fmtDelta(funnel.deltaPct.payments) : null}
          />
          <Stat
            label="Revenue"
            value={fmtRevenue(funnel.totals.revenue_cents)}
            delta={funnel.deltaPct ? fmtDelta(funnel.deltaPct.revenue_cents) : null}
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-muted-foreground">
          <span>Visit → Signup <strong className="text-primary">{fmtPct(rates.visit_to_signup)}</strong></span>
          <span>Signup → Booking <strong className="text-primary">{fmtPct(rates.signup_to_booking)}</strong></span>
          <span>Booking → Payment <strong className="text-primary">{fmtPct(rates.booking_to_payment)}</strong></span>
        </div>
      </section>

      {/* Two columns: pending recs + agent memo */}
      <section className="grid lg:grid-cols-2 gap-4">
        <PendingRecsCard recs={topRecs} pending={recCounts.pending} failed={recCounts.failed} />
        <LatestMemoCard memo={latestMemo} />
      </section>

      {/* Conversion upload health */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            ─ Conversion uploads
          </h2>
          <Link
            href="/admin/ads/conversions"
            className="text-[11px] font-mono text-muted-foreground hover:text-accent"
          >
            Manage →
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile
            label="Pending"
            value={fmtNumber(uploadCounts.pending)}
            tone="bg-accent/10 text-accent"
          />
          <Tile
            label="Uploaded"
            value={fmtNumber(uploadCounts.uploaded)}
            tone="bg-success/10 text-success"
          />
          <Tile
            label="Failed"
            value={fmtNumber(uploadCounts.failed)}
            tone="bg-error/10 text-error"
          />
          <Tile
            label="Skipped"
            value={fmtNumber(uploadCounts.skipped)}
            tone="bg-muted/40 text-muted-foreground"
          />
        </div>
      </section>

      {/* Quick links to working surfaces */}
      <section>
        <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
          ─ Surfaces
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SurfaceTile
            href="/admin/ads/agent"
            icon={Bot}
            title="AI Ads Agent"
            description="Wednesday strategist memo + ad-hoc Q&A grounded in the live account."
          />
          <SurfaceTile
            href="/admin/ads/campaigns"
            icon={BarChart3}
            title="Campaigns"
            description="Live mirror with last-7-day metrics and manual Sync now."
          />
          <SurfaceTile
            href="/admin/ads/recommendations"
            icon={Sparkles}
            title="Recommendations"
            description="AI-generated optimizations with approve / reject + apply path."
          />
          <SurfaceTile
            href="/admin/ads/pipeline"
            icon={Layers}
            title="Pipeline"
            description="Visits → signups → bookings → payments → revenue, by source."
          />
          <SurfaceTile
            href="/admin/ads/conversions"
            icon={TrendingUp}
            title="Conversions"
            description="Offline click uploads + Stripe value adjustments. 15-min worker."
          />
          <SurfaceTile
            href="/admin/ads/audiences"
            icon={Users}
            title="Audiences"
            description="Customer Match (bookers/subscribers) + GA4 remarketing list cache."
          />
          <SurfaceTile
            href="/admin/ads/ga4-overview"
            icon={LineChart}
            title="GA4 Overview"
            description="Live read-only reports from the GA4 Data API: 28-day overview."
          />
          <SurfaceTile
            href="/admin/ads/automation-log"
            icon={ClipboardCheck}
            title="Automation Log"
            description="Audit trail of every Google Ads mutation — request, response, result."
          />
          <SurfaceTile
            href="/admin/ads/consent"
            icon={ShieldCheck}
            title="Consent Log"
            description="Audit of marketing-consent grants/revocations for Customer Match."
          />
          <SurfaceTile
            href="/admin/ads/settings"
            icon={Settings}
            title="Settings"
            description="OAuth status, connected customer accounts, last-sync timestamps."
          />
        </div>
      </section>
    </div>
  )
}

function ConnectionBanner({
  isConnected,
  accountHandle,
  activeCount,
  lastSynced,
  errorMessage,
}: {
  isConnected: boolean
  accountHandle: string | null
  activeCount: number
  lastSynced: string | null
  errorMessage: string | null
}) {
  if (!isConnected) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-warning">Google Ads not connected.</p>
          <p className="text-xs text-warning/80 mt-1">
            OAuth handshake required before any of the admin surfaces show live data.
          </p>
        </div>
        <Link
          href="/admin/ads/settings"
          className="text-xs px-3 py-1.5 rounded-md border border-warning/40 hover:bg-warning/10 text-warning shrink-0"
        >
          Connect →
        </Link>
      </div>
    )
  }
  const tone = errorMessage ? "border-error/40 bg-error/5" : "border-success/40 bg-success/5"
  const labelTone = errorMessage ? "text-error" : "text-success"
  return (
    <div className={`rounded-xl border ${tone} p-4 flex items-start justify-between gap-4`}>
      <div className="min-w-0">
        <p className={`text-sm font-medium ${labelTone}`}>
          Connected{accountHandle ? ` · ${accountHandle}` : ""}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {activeCount} active {activeCount === 1 ? "account" : "accounts"} · last sync{" "}
          <span className="font-mono">{relativeTime(lastSynced)}</span>
          {errorMessage ? (
            <>
              {" · "}
              <span className="text-error">{errorMessage.slice(0, 100)}</span>
            </>
          ) : null}
        </p>
      </div>
      <Link
        href="/admin/ads/campaigns"
        className="text-xs px-3 py-1.5 rounded-md border border-border hover:border-accent/60 hover:text-accent shrink-0"
      >
        Sync now →
      </Link>
    </div>
  )
}

function PendingRecsCard({
  recs,
  pending,
  failed,
}: {
  recs: GoogleAdsRecommendation[]
  pending: number
  failed: number
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="font-heading text-primary text-sm">
          Top recommendations · {pending} pending
          {failed > 0 ? <span className="text-error"> · {failed} failed</span> : null}
        </p>
        <Link
          href="/admin/ads/recommendations"
          className="text-[11px] font-mono text-muted-foreground hover:text-accent"
        >
          Queue →
        </Link>
      </div>
      {recs.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4">
          Nothing pending. Auto-pilot picks up high-confidence negative keywords automatically;
          new recs land after each nightly sync.
        </p>
      ) : (
        <ul className="space-y-2">
          {recs.map((rec) => (
            <li
              key={rec.id}
              className="flex items-start gap-3 border-t border-border/60 pt-2 first:border-t-0 first:pt-0"
            >
              <span className="shrink-0 inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-accent/15 text-accent">
                {REC_TYPE_LABEL[rec.recommendation_type]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-primary truncate">{recSummary(rec)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                  {rec.reasoning}
                </p>
              </div>
              <span className="shrink-0 text-[11px] font-mono text-muted-foreground">
                {(rec.confidence * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LatestMemoCard({
  memo,
}: {
  memo: Awaited<ReturnType<typeof listAgentMemos>>[number] | null
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="font-heading text-primary text-sm">Latest agent memo</p>
        <Link
          href="/admin/ads/agent"
          className="text-[11px] font-mono text-muted-foreground hover:text-accent"
        >
          AI Agent →
        </Link>
      </div>
      {!memo ? (
        <p className="text-xs text-muted-foreground py-4">
          No memos yet. The agent writes one each Wednesday at 13:00 UTC; trigger one manually
          from the AI Agent page.
        </p>
      ) : (
        <>
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Week of {new Date(memo.week_of).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              {" · "}{relativeTime(memo.created_at)}
            </p>
            <p className="font-medium text-primary text-sm mt-1 leading-snug">{memo.subject}</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
            {memo.sections.executive_summary}
          </p>
          <Link
            href={`/admin/ads/agent/${memo.id}`}
            className="inline-block text-xs px-3 py-1.5 rounded-md border border-border hover:border-accent/60 hover:text-accent"
          >
            View full memo →
          </Link>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-xl border border-border p-4 ${tone}`}>
      <p className="text-[11px] font-mono uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-2xl font-heading mt-1">{value}</p>
    </div>
  )
}

function Stat({
  label,
  value,
  delta,
}: {
  label: string
  value: string
  delta: { label: string; tone: string } | null
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-2xl font-heading text-primary mt-1">{value}</p>
      {delta ? <p className={`text-[11px] font-mono mt-1 ${delta.tone}`}>{delta.label}</p> : null}
    </div>
  )
}

function SurfaceTile({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string
  icon: typeof Target
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/60"
    >
      <div className="size-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
        <Icon className="size-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-heading text-primary text-sm leading-snug">{title}</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
      </div>
    </Link>
  )
}
