"use client"

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { SectionHeading } from "./SectionHeading"
import type { TestProgression } from "@/lib/profile-share/progression"

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })

function TrendTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean
  payload?: { payload: { date: string; value: number } }[]
  unit: string
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-border bg-background/95 px-3 py-2 shadow-xl backdrop-blur">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {MONTH_YEAR.format(new Date(p.date))}
      </p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-primary">
        {p.value} {unit}
      </p>
    </div>
  )
}

/**
 * Small-multiple trend charts — one single-series line per test type, shared
 * anatomy, never a dual axis. Detail view of the same series the Progress
 * tab summarizes.
 */
export function TestTrendCharts({ progressions }: { progressions: TestProgression[] }) {
  const charted = progressions.filter((p) => p.series.length >= 2)
  if (charted.length === 0) return null

  return (
    <section aria-label="Test trends" className="mt-14">
      <SectionHeading>Test Trends</SectionHeading>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {charted.map((p) => (
          <div key={p.key} className="rounded-2xl border border-border bg-card/70 p-4 backdrop-blur-sm">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="min-w-0 truncate text-sm text-foreground/90">{p.label}</h3>
              <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-primary">
                {p.latest} {p.unit}
              </span>
            </div>
            <div className="mt-3 h-28 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={p.series} margin={{ top: 6, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" hide />
                  <YAxis hide domain={["auto", "auto"]} />
                  <Tooltip content={<TrendTooltip unit={p.unit} />} cursor={{ stroke: "var(--border)" }} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={{ r: 2.5, fill: "var(--accent)", strokeWidth: 0 }}
                    activeDot={{ r: 4, fill: "var(--accent)", strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">
              {MONTH_YEAR.format(new Date(p.series[0].date))} → {MONTH_YEAR.format(new Date(p.latestDate))} ·{" "}
              {p.series.length} tests
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
