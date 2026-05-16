"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { RevenueSnapshot } from "@/types/database"

const PRIMARY_HEX = "#0E3F50"
const ACCENT_HEX = "#C49B7A"

interface Props {
  snapshots: RevenueSnapshot[]
}

function fmtMoney(cents: number): string {
  const d = cents / 100
  if (Math.abs(d) >= 1_000) return `$${(d / 1_000).toFixed(1)}K`
  return `$${d.toFixed(2)}`
}

export function RevenueDigestCard({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No revenue snapshots yet. Trigger the route manually:{" "}
        <code>POST /api/admin/internal/revenue-digest</code> or wait for{" "}
        <code>revenueDigestCron</code> (Mon 13:00 UTC).
      </p>
    )
  }

  // Recharts wants oldest-first.
  const seriesAsc = [...snapshots].sort((a, b) => a.week_of.localeCompare(b.week_of))
  const latest = snapshots[0]

  return (
    <div className="space-y-6">
      <div className="rounded border border-border p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Current MRR · {latest.week_of}
        </p>
        <p className="mt-1 font-heading text-3xl text-primary">{fmtMoney(latest.mrr_cents)}</p>
        <p
          className={`mt-1 text-sm font-semibold ${
            latest.mrr_delta_cents === 0
              ? "text-muted-foreground"
              : latest.mrr_delta_cents > 0
                ? "text-emerald-700"
                : "text-red-700"
          }`}
        >
          {latest.mrr_delta_cents === 0
            ? "no change"
            : `${latest.mrr_delta_cents > 0 ? "▲" : "▼"} ${fmtMoney(Math.abs(latest.mrr_delta_cents))}`}{" "}
          vs last week
        </p>
      </div>

      <div className="rounded border border-border p-4">
        <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">MRR — last {seriesAsc.length} weeks</p>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={seriesAsc.map((s) => ({ week: s.week_of, mrr: s.mrr_cents / 100 }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8e5e0" />
            <XAxis dataKey="week" fontSize={11} stroke={PRIMARY_HEX} />
            <YAxis fontSize={11} stroke={PRIMARY_HEX} tickFormatter={(v: number) => `$${v}`} />
            <Tooltip formatter={(v: number | undefined) => [`$${(v ?? 0).toFixed(2)}`, "MRR"]} />
            <Area type="monotone" dataKey="mrr" stroke={PRIMARY_HEX} fill={ACCENT_HEX} fillOpacity={0.3} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter label="New customers (7d)" value={String(latest.new_customers)} />
        <Counter label="Churned (7d)" value={String(latest.churned_customers)} />
        <Counter
          label="Failed payments (7d)"
          value={`${latest.failed_payments_7d} · ${fmtMoney(latest.failed_payment_value_cents)}`}
          warn={latest.failed_payments_7d > 0}
        />
        <Counter
          label="Renewals (14d)"
          value={`${latest.upcoming_renewals_14d} · ${fmtMoney(latest.upcoming_renewals_value_cents)}`}
        />
      </div>

      {latest.top_at_risk_subscriptions.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-4">
          <p className="text-xs uppercase tracking-wider text-red-900">At-risk subscriptions</p>
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            {latest.top_at_risk_subscriptions.map((r, i) => (
              <li key={i}>
                <strong>{r.customer_email || "(unknown)"}</strong> · {fmtMoney(r.mrr_cents)} MRR ·{" "}
                renews {new Date(r.renewal_at).toLocaleDateString()} ·{" "}
                <span className="text-red-700">
                  {r.reason === "cancel_at_period_end" ? "canceling at period end" : "payment failed"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Counter({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded border border-border p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 font-heading text-base ${warn ? "text-red-700" : "text-primary"}`}>{value}</p>
    </div>
  )
}
