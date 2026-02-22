"use client"

import {
  Dumbbell,
  Trophy,
  UserCheck,
  Gauge,
  Flame,
  Medal,
  Target,
  Star,
} from "lucide-react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import type { EngagementMetrics } from "@/types/analytics"
import { StatCard } from "./StatCard"
import { HorizontalBar } from "./HorizontalBar"

// Recharts needs plain hex — CSS vars use oklch which Recharts can't resolve
const CHART = {
  indigo: "#6366f1",     // workout activity — vibrant purple-blue
  indigoLight: "#6366f1",
  grid: "#e5e7eb",
  tick: "#6b7280",
  border: "#e5e7eb",
} as const

const ACHIEVEMENT_ICONS: Record<string, React.ReactNode> = {
  pr: <Trophy className="size-4 text-warning" />,
  streak: <Flame className="size-4 text-destructive" />,
  milestone: <Medal className="size-4 text-primary" />,
  completion: <Target className="size-4 text-success" />,
}

const ACHIEVEMENT_COLORS: Record<string, string> = {
  pr: "bg-warning/10",
  streak: "bg-destructive/10",
  milestone: "bg-primary/10",
  completion: "bg-success/10",
}

interface EngagementTabProps {
  data: EngagementMetrics
}

export function EngagementTab({ data }: EngagementTabProps) {
  const chartData = data.workoutsByMonth.map((m) => ({
    name: m.label,
    workouts: m.count,
  }))

  return (
    <div>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<Dumbbell className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Workouts Logged"
          value={data.totalWorkoutsLogged}
        />
        <StatCard
          icon={<Trophy className="size-4 text-warning" />}
          iconBg="bg-warning/10"
          label="PRs This Period"
          value={data.prsInRange}
        />
        <StatCard
          icon={<UserCheck className="size-4 text-success" />}
          iconBg="bg-success/10"
          label="Active This Week"
          value={data.activeUsersThisWeek}
        />
        <StatCard
          icon={<Gauge className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Avg RPE"
          value={data.avgRPE != null ? data.avgRPE.toFixed(1) : "—"}
        />
      </div>

      {/* Workout Activity Chart */}
      <div className="bg-white rounded-xl border border-border shadow-sm mb-8">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Dumbbell className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">
            Workout Activity
          </h2>
        </div>
        <div className="p-4">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="workoutGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.indigoLight} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={CHART.indigoLight} stopOpacity={0.02} />
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
                  dataKey="workouts"
                  stroke={CHART.indigo}
                  strokeWidth={2}
                  fill="url(#workoutGrad)"
                  name="Workouts"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
              No workout data in this period.
            </div>
          )}
        </div>
      </div>

      {/* Middle row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Top Exercises */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <Dumbbell className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-primary">
              Top Exercises
            </h2>
          </div>
          <HorizontalBar
            items={data.topExercises}
            formatValue={(v) => `${v} logs`}
            emptyMessage="No exercise data yet."
          />
        </div>

        {/* Most Active Clients */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <Star className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-primary">
              Most Active Clients
            </h2>
          </div>
          {data.mostActiveClients.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No workout data yet.
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
                      Workouts
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.mostActiveClients.map((c, i) => (
                    <tr
                      key={i}
                      className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {c.name}
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

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Achievement Breakdown */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <Trophy className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-primary">
              Achievements
            </h2>
          </div>
          <div className="p-4">
            {data.achievementsByType.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No achievements in this period.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {data.achievementsByType.map((a) => (
                  <div
                    key={a.type}
                    className={`rounded-lg p-3 ${
                      ACHIEVEMENT_COLORS[a.type] ?? "bg-muted"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {ACHIEVEMENT_ICONS[a.type] ?? (
                        <Medal className="size-4 text-muted-foreground" />
                      )}
                      <span className="text-xs font-medium capitalize text-muted-foreground">
                        {a.type === "pr" ? "PRs" : `${a.type}s`}
                      </span>
                    </div>
                    <p className="text-2xl font-semibold text-foreground">
                      {a.count}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Streak Leaders */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <Flame className="size-4 text-destructive" />
            <h2 className="text-sm font-semibold text-primary">
              Streak Leaders
            </h2>
          </div>
          {data.streakLeaders.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No active streaks.
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
                      Streak
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.streakLeaders.map((s, i) => (
                    <tr
                      key={i}
                      className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {s.name}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-destructive font-medium">
                          <Flame className="size-3" />
                          {s.streak} {s.streak === 1 ? "day" : "days"}
                        </span>
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
