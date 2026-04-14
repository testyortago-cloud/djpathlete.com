"use client"

import { DollarSign, TrendingUp, TrendingDown } from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"

const CHART = {
  green: "#22c55e",
  grid: "#e5e7eb",
  tick: "#6b7280",
  border: "#e5e7eb",
} as const

interface RevenueChartProps {
  data: { label: string; revenue: number }[]
  thisMonth: number
  lastMonth: number
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function RevenueChart({ data, thisMonth, lastMonth }: RevenueChartProps) {
  const chartData = data.map((d) => ({
    name: d.label,
    revenue: d.revenue / 100,
  }))

  const pct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <DollarSign className="size-4 text-success" />
          <h2 className="text-sm font-semibold text-primary">Revenue Trend</h2>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            This month: <span className="font-medium text-foreground">{formatCents(thisMonth)}</span>
          </span>
          {pct !== 0 && (
            <span
              className={`inline-flex items-center gap-0.5 text-xs font-medium ${
                pct > 0 ? "text-success" : "text-destructive"
              }`}
            >
              {pct > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              {pct > 0 ? "+" : ""}
              {pct}% vs last month
            </span>
          )}
        </div>
      </div>
      <div className="p-4">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="dashRevGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.green} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={CHART.green} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: CHART.tick }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: CHART.tick }}
                tickFormatter={(v) => `$${v}`}
                axisLine={false}
                tickLine={false}
                width={50}
              />
              <Tooltip
                formatter={(value) => [`$${Number(value).toFixed(2)}`, "Revenue"]}
                contentStyle={{
                  borderRadius: "8px",
                  border: `1px solid ${CHART.border}`,
                  fontSize: "12px",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
              />
              <Area type="monotone" dataKey="revenue" stroke={CHART.green} strokeWidth={2} fill="url(#dashRevGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
            No revenue data yet.
          </div>
        )}
      </div>
    </div>
  )
}
