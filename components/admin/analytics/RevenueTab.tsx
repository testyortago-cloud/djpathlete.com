"use client"

import { DollarSign, TrendingUp, Hash, CreditCard } from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import type { RevenueMetrics } from "@/types/analytics"
import { StatCard } from "./StatCard"

// Recharts needs plain hex — CSS vars use oklch which Recharts can't resolve
const CHART = {
  green: "#22c55e",      // revenue bars — a confident green
  greenLight: "#bbf7d0", // revenue gradient
  grid: "#e5e7eb",       // subtle grid lines
  tick: "#6b7280",       // axis labels
  border: "#e5e7eb",     // tooltip border
} as const

const STATUS_COLORS: Record<string, string> = {
  succeeded: "bg-success/10 text-success",
  pending: "bg-warning/10 text-warning",
  failed: "bg-destructive/10 text-destructive",
  refunded: "bg-muted text-muted-foreground",
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

interface RevenueTabProps {
  data: RevenueMetrics
}

export function RevenueTab({ data }: RevenueTabProps) {
  const chartData = data.revenueByMonth.map((m) => ({
    name: m.label,
    revenue: m.total / 100,
    transactions: m.count,
  }))

  return (
    <div>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<DollarSign className="size-4 text-success" />}
          iconBg="bg-success/10"
          label="Total Revenue"
          value={formatCents(data.totalRevenue)}
          trend={{
            current: data.totalRevenue,
            previous: data.previousPeriodRevenue,
          }}
        />
        <StatCard
          icon={<TrendingUp className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="This Month"
          value={formatCents(data.thisMonthRevenue)}
        />
        <StatCard
          icon={<CreditCard className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Transactions"
          value={data.transactionCount}
        />
        <StatCard
          icon={<Hash className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Avg Transaction"
          value={formatCents(data.avgTransaction)}
        />
      </div>

      {/* Monthly Revenue Chart */}
      <div className="bg-white rounded-xl border border-border shadow-sm mb-8">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <DollarSign className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">
            Monthly Revenue
          </h2>
        </div>
        <div className="p-4">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.green} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={CHART.green} stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: CHART.tick }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: CHART.tick }}
                  tickFormatter={(v) => `$${v}`}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value) => [`$${Number(value).toFixed(2)}`, "Revenue"]}
                  contentStyle={{
                    borderRadius: "8px",
                    border: `1px solid ${CHART.border}`,
                    fontSize: "12px",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                  cursor={{ fill: CHART.green, opacity: 0.06 }}
                />
                <Bar dataKey="revenue" fill="url(#revenueGrad)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
              No revenue data in this period.
            </div>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Status */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <CreditCard className="size-4 text-primary" />
            <h2 className="text-lg font-semibold text-primary">
              Payment Status
            </h2>
          </div>
          <div className="p-4">
            {data.revenueByStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No payments in this period.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {data.revenueByStatus.map((s) => (
                  <div
                    key={s.status}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 ${
                      STATUS_COLORS[s.status] ?? "bg-muted text-muted-foreground"
                    }`}
                  >
                    <span className="text-sm font-medium capitalize">
                      {s.status}
                    </span>
                    <span className="text-lg font-semibold">{s.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Top Paying Clients */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <DollarSign className="size-4 text-primary" />
            <h2 className="text-lg font-semibold text-primary">
              Top Paying Clients
            </h2>
          </div>
          {data.topPayingClients.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No client payments in this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Client
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Total
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Txns
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.topPayingClients.map((c) => (
                    <tr
                      key={c.email}
                      className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.email}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {formatCents(c.total)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
