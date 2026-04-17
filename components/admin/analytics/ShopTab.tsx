"use client"

import {
  DollarSign,
  TrendingUp,
  Percent,
  ShoppingBag,
  Download,
  Shirt,
} from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import type { ShopMetrics } from "@/types/analytics"
import { StatCard } from "./StatCard"
import { cn } from "@/lib/utils"

// Recharts needs plain hex — CSS vars use oklch which Recharts can't resolve
const CHART = {
  pod: "#0e3f50", // primary (green-azure)
  digital: "#c49b7a", // accent (gray-orange)
  grid: "#e5e7eb",
  tick: "#6b7280",
  border: "#e5e7eb",
} as const

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`
}

interface ShopTabProps {
  data: ShopMetrics
}

export function ShopTab({ data }: ShopTabProps) {
  const chartData = data.revenueByMonth.map((m) => ({
    name: m.label,
    pod: m.pod / 100,
    digital: m.digital / 100,
  }))

  return (
    <div>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<DollarSign className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Shop Revenue"
          value={fmtCents(data.totalRevenueCents)}
          trend={{
            current: data.totalRevenueCents,
            previous: data.previousPeriodRevenueCents,
          }}
        />
        <StatCard
          icon={<TrendingUp className="size-4 text-success" />}
          iconBg="bg-success/10"
          label="Gross Profit"
          value={fmtCents(data.grossProfitCents)}
        />
        <StatCard
          icon={<Percent className="size-4 text-success" />}
          iconBg="bg-success/10"
          label="Gross Margin"
          value={fmtBps(data.grossMarginBps)}
        />
        <StatCard
          icon={<ShoppingBag className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Orders"
          value={data.totalOrders}
        />
      </div>

      {/* Stacked revenue chart */}
      <div className="bg-white rounded-xl border border-border shadow-sm mb-8">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <DollarSign className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">
            Monthly Shop Revenue
          </h2>
        </div>
        <div className="p-4">
          {chartData.length > 0 && chartData.some((d) => d.pod + d.digital > 0) ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={CHART.grid}
                  vertical={false}
                />
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
                  formatter={(value, name) =>
                    [
                      `$${Number(value).toFixed(2)}`,
                      name === "pod" ? "Apparel" : "Digital",
                    ] as [string, string]
                  }
                  contentStyle={{
                    borderRadius: "8px",
                    border: `1px solid ${CHART.border}`,
                    fontSize: "12px",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                  cursor={{ fill: CHART.pod, opacity: 0.04 }}
                />
                <Legend
                  formatter={(value) => (value === "pod" ? "Apparel" : "Digital")}
                  wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                />
                <Bar
                  dataKey="pod"
                  stackId="revenue"
                  fill={CHART.pod}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="digital"
                  stackId="revenue"
                  fill={CHART.digital}
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
              No shop revenue in this period.
            </div>
          )}
        </div>
      </div>

      {/* Breakdown + top products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BreakdownCard
          icon={Shirt}
          label="Apparel (POD)"
          orders={data.podOrders}
          revenue={data.podRevenueCents}
          cogs={data.podCogsCents}
          profit={data.podProfitCents}
          marginBps={data.podMarginBps}
          accentColor={CHART.pod}
        />
        <BreakdownCard
          icon={Download}
          label="Digital"
          orders={data.digitalOrders}
          revenue={data.digitalRevenueCents}
          cogs={0}
          profit={data.digitalProfitCents}
          marginBps={data.digitalMarginBps}
          accentColor={CHART.digital}
        />
      </div>

      {/* Top products */}
      <div className="mt-6 bg-white rounded-xl border border-border shadow-sm">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <ShoppingBag className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">Top Products</h2>
        </div>
        {data.topProducts.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No product sales in this period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Product
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Type
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                    Units
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((p) => (
                  <tr
                    key={p.product_id}
                    className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {p.product_name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest",
                          p.product_type === "digital"
                            ? "bg-accent/15 text-accent"
                            : "bg-primary/10 text-primary",
                        )}
                      >
                        {p.product_type === "digital" ? "digital" : "apparel"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {p.unitsSold}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">
                      {fmtCents(p.revenueCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground leading-relaxed">
        Revenue uses product subtotal (shipping excluded from margin). POD costs
        come from the order&apos;s Printful cost snapshot, falling back to the current
        variant cost for legacy orders.
      </p>
    </div>
  )
}

function BreakdownCard({
  icon: Icon,
  label,
  orders,
  revenue,
  cogs,
  profit,
  marginBps,
  accentColor,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  orders: number
  revenue: number
  cogs: number
  profit: number
  marginBps: number
  accentColor: string
}) {
  const empty = orders === 0
  return (
    <div
      className={cn(
        "bg-white rounded-xl border shadow-sm overflow-hidden",
        empty ? "border-dashed border-border" : "border-border",
      )}
    >
      <div
        className="h-1 w-full"
        style={{ backgroundColor: accentColor, opacity: empty ? 0.25 : 1 }}
      />
      <div className="p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-4" />
            </div>
            <h3 className="font-semibold text-primary">{label}</h3>
          </div>
          <span className="text-[11px] font-mono text-muted-foreground">
            {orders} order{orders === 1 ? "" : "s"}
          </span>
        </div>

        {empty ? (
          <p className="text-sm text-muted-foreground py-2">No sales in this period.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm">
            <dt className="text-xs text-muted-foreground">Revenue</dt>
            <dd className="text-right font-medium text-foreground">
              {fmtCents(revenue)}
            </dd>

            <dt className="text-xs text-muted-foreground">COGS</dt>
            <dd className="text-right font-medium text-muted-foreground">
              {cogs === 0 ? "—" : fmtCents(cogs)}
            </dd>

            <dt className="text-xs text-muted-foreground pt-2 border-t border-border">
              Gross Profit
            </dt>
            <dd className="text-right font-semibold text-primary pt-2 border-t border-border">
              {fmtCents(profit)}
            </dd>

            <dt className="text-xs text-muted-foreground">Margin</dt>
            <dd className="text-right font-medium text-primary">{fmtBps(marginBps)}</dd>
          </dl>
        )}
      </div>
    </div>
  )
}
