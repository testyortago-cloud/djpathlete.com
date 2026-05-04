import Link from "next/link"
import {
  buildPipelineFunnelWithComparison,
  computeRates,
  type FunnelDeltaPct,
} from "@/lib/ads/pipeline"

export const metadata = { title: "Google Ads — Pipeline" }
export const dynamic = "force-dynamic"

const DAY_OPTIONS = [7, 28, 90] as const
type DayWindow = (typeof DAY_OPTIONS)[number]

interface PageProps {
  searchParams: Promise<{ days?: string }>
}

function fmtNumber(n: number): string {
  if (n === 0) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString("en-US")
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

function fmtDelta(pct: number | null, invert = false): { label: string; tone: string } | null {
  if (pct === null || Number.isNaN(pct)) return null
  const rounded = Math.round(pct * 10) / 10
  if (rounded === 0) return { label: "no change", tone: "text-muted-foreground" }
  const sign = rounded > 0 ? "+" : ""
  const isGood = invert ? rounded < 0 : rounded > 0
  return {
    label: `${sign}${rounded}% vs prev ${rounded > 0 ? "+" : ""}`.replace(/\+ \+/, "+").replace(/\s\+$/, ""),
    tone: isGood ? "text-success" : "text-error",
  }
}

export default async function PipelinePage({ searchParams }: PageProps) {
  const sp = await searchParams
  const requestedDays = Number(sp.days)
  const days: DayWindow = DAY_OPTIONS.includes(requestedDays as DayWindow)
    ? (requestedDays as DayWindow)
    : 28

  const rangeEnd = new Date()
  const rangeStart = new Date(rangeEnd.getTime() - days * 86_400_000)

  const funnel = await buildPipelineFunnelWithComparison({ rangeStart, rangeEnd })
  const rates = computeRates(funnel.totals)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading text-primary">Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Visit → newsletter signup → booking → paid customer funnel by campaign and source.
            Revenue is sum of <code className="font-mono text-xs">payments.amount_cents</code> in
            the window where status is <code className="font-mono text-xs">succeeded</code>.
            Untagged actions roll up to{" "}
            <code className="font-mono text-xs">(direct)</code>.
          </p>
        </div>
        <div className="flex items-center gap-1 border border-border rounded-md p-1 bg-card">
          {DAY_OPTIONS.map((d) => {
            const active = d === days
            return (
              <Link
                key={d}
                href={`/admin/ads/pipeline?days=${d}`}
                className={`text-xs px-2.5 py-1 rounded ${active ? "bg-accent text-white" : "text-muted-foreground hover:text-primary"}`}
              >
                {d}d
              </Link>
            )
          })}
        </div>
      </div>

      <FunnelStats totals={funnel.totals} delta={funnel.deltaPct} />

      <RatesRow rates={rates} />

      <BreakdownTable
        title="By campaign"
        rows={funnel.byCampaign.slice(0, 20)}
      />

      <BreakdownTable
        title="By source"
        rows={funnel.bySource.slice(0, 20)}
      />

      <p className="text-xs text-muted-foreground">
        Joining model: action tables (newsletter, bookings, payments) are
        attributed by gclid → marketing_attribution → utm_*. Actions without
        a click identifier in the window roll up to (direct). Time range
        compares against the immediately preceding {days}-day window.
      </p>
    </div>
  )
}

function FunnelStats({
  totals,
  delta,
}: {
  totals: { visits: number; signups: number; bookings: number; payments: number; revenue_cents: number }
  delta?: FunnelDeltaPct
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <Stat label="Visits" value={fmtNumber(totals.visits)} delta={delta ? fmtDelta(delta.visits) : null} />
      <Stat label="Signups" value={fmtNumber(totals.signups)} delta={delta ? fmtDelta(delta.signups) : null} />
      <Stat label="Bookings" value={fmtNumber(totals.bookings)} delta={delta ? fmtDelta(delta.bookings) : null} />
      <Stat label="Payments" value={fmtNumber(totals.payments)} delta={delta ? fmtDelta(delta.payments) : null} />
      <Stat
        label="Revenue"
        value={fmtRevenue(totals.revenue_cents)}
        delta={delta ? fmtDelta(delta.revenue_cents) : null}
      />
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

function RatesRow({ rates }: { rates: { visit_to_signup: number; signup_to_booking: number; booking_to_payment: number } }) {
  return (
    <div className="border border-border rounded-xl bg-card p-4">
      <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
        ─ Conversion rates
      </p>
      <div className="grid grid-cols-3 gap-4">
        <RateBlock label="Visit → Signup" value={rates.visit_to_signup} />
        <RateBlock label="Signup → Booking" value={rates.signup_to_booking} />
        <RateBlock label="Booking → Payment" value={rates.booking_to_payment} />
      </div>
    </div>
  )
}

function RateBlock({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-heading text-primary mt-0.5">{fmtPct(value)}</p>
    </div>
  )
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string
  rows: Array<{
    dimension: string
    visits: number
    signups: number
    bookings: number
    payments: number
    revenue_cents: number
  }>
}) {
  if (rows.length === 0) {
    return (
      <section>
        <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
          ─ {title}
        </h2>
        <div className="border border-dashed border-border rounded-xl p-6 bg-card text-sm text-muted-foreground text-center">
          No data in this window.
        </div>
      </section>
    )
  }
  return (
    <section>
      <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
        ─ {title}
      </h2>
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left p-3">{title.replace("By ", "")}</th>
              <th className="text-right p-3 w-20">Visits</th>
              <th className="text-right p-3 w-20">Signups</th>
              <th className="text-right p-3 w-20">Bookings</th>
              <th className="text-right p-3 w-20">Payments</th>
              <th className="text-right p-3 w-24">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.dimension} className="border-t border-border/60">
                <td className="p-3 font-medium text-primary">{r.dimension}</td>
                <td className="p-3 text-right font-mono text-xs">{fmtNumber(r.visits)}</td>
                <td className="p-3 text-right font-mono text-xs">{fmtNumber(r.signups)}</td>
                <td className="p-3 text-right font-mono text-xs">{fmtNumber(r.bookings)}</td>
                <td className="p-3 text-right font-mono text-xs">{fmtNumber(r.payments)}</td>
                <td className="p-3 text-right font-mono text-xs">{fmtRevenue(r.revenue_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
