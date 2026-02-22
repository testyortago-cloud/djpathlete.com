"use client"

import { Users, UserPlus, UserCheck, ClipboardCheck } from "lucide-react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import type { ClientMetrics } from "@/types/analytics"
import { StatCard } from "./StatCard"
import { HorizontalBar } from "./HorizontalBar"

// Recharts needs plain hex — CSS vars use oklch which Recharts can't resolve
const CHART = {
  teal: "#0E3F50",       // primary brand — total clients line
  tealLight: "#0E3F50",  // fill under total line
  emerald: "#10b981",    // new signups area — fresh green
  emeraldLight: "#10b981",
  grid: "#e5e7eb",
  tick: "#6b7280",
  border: "#e5e7eb",
} as const

interface ClientsTabProps {
  data: ClientMetrics
}

export function ClientsTab({ data }: ClientsTabProps) {
  const chartData = data.clientsByMonth.map((m) => ({
    name: m.label,
    new: m.count,
    total: m.cumulative,
  }))

  return (
    <div>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<Users className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Total Clients"
          value={data.totalClients}
        />
        <StatCard
          icon={<UserPlus className="size-4 text-success" />}
          iconBg="bg-success/10"
          label="New in Period"
          value={data.newClientsInRange}
        />
        <StatCard
          icon={<UserCheck className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Active (on program)"
          value={data.activeClients}
        />
        <StatCard
          icon={<ClipboardCheck className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Profile Completion"
          value={`${data.profileCompletionRate}%`}
        />
      </div>

      {/* Client Growth Chart */}
      <div className="bg-white rounded-xl border border-border shadow-sm mb-8">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Users className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">Client Growth</h2>
        </div>
        <div className="p-4">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.tealLight} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={CHART.tealLight} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="newGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.emeraldLight} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={CHART.emeraldLight} stopOpacity={0.02} />
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
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: `1px solid ${CHART.border}`,
                    fontSize: "12px",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke={CHART.teal}
                  strokeWidth={2}
                  fill="url(#totalGrad)"
                  name="Total Clients"
                />
                <Area
                  type="monotone"
                  dataKey="new"
                  stroke={CHART.emerald}
                  strokeWidth={2}
                  fill="url(#newGrad)"
                  name="New Signups"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
              No client data in this period.
            </div>
          )}
        </div>
      </div>

      {/* Demographics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-primary">By Sport</h2>
          </div>
          <HorizontalBar
            items={data.clientsBySport}
            emptyMessage="No sport data available."
          />
        </div>

        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-primary">
              By Experience
            </h2>
          </div>
          <HorizontalBar
            items={data.clientsByExperience}
            colorClass="bg-accent"
            emptyMessage="No experience data available."
          />
        </div>

        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-primary">By Goals</h2>
          </div>
          <HorizontalBar
            items={data.clientsByGoal}
            colorClass="bg-success"
            emptyMessage="No goal data available."
          />
        </div>
      </div>
    </div>
  )
}
