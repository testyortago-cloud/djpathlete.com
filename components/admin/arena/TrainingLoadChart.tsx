"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { formatCompact } from "./StatTiles"
import { SectionHeading } from "./SectionHeading"
import type { MonthlyTraining } from "@/lib/profile-share/monthly"

function LoadTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: MonthlyTraining }[]
}) {
  if (!active || !payload?.length) return null
  const m = payload[0].payload
  return (
    <div className="rounded-lg border border-border bg-background/95 px-3 py-2 shadow-xl backdrop-blur">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{m.label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-primary">
        {m.volumeKg.toLocaleString()} kg
      </p>
      <p className="font-mono text-[10px] text-muted-foreground">{m.sessions} sessions</p>
    </div>
  )
}

/**
 * Monthly training volume — one measure, one axis (sessions ride along in the
 * tooltip, never as a second scale). Self-hides when the window is empty.
 */
export function TrainingLoadChart({ data }: { data: MonthlyTraining[] }) {
  if (data.length === 0) return null
  const total = data.reduce((s, m) => s + m.volumeKg, 0)
  return (
    <section aria-label="Training load" className="mt-14">
      <SectionHeading>Training Load</SectionHeading>
      <div className="mt-5 rounded-2xl border border-border bg-card/70 p-4 backdrop-blur-sm md:p-6">
        <div className="h-48 w-full md:h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                width={34}
                tickFormatter={(v: number) => formatCompact(v)}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickCount={4}
              />
              <Tooltip content={<LoadTooltip />} cursor={{ fill: "oklch(1 0 0 / 0.05)" }} />
              <Bar dataKey="volumeKg" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Monthly volume (kg) from logged workouts · {formatCompact(total)} kg in this window
        </p>
      </div>
    </section>
  )
}
