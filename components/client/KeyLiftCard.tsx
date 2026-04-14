"use client"

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts"
import { Badge } from "@/components/ui/badge"
import { Trophy, TrendingUp, TrendingDown, Minus, Dumbbell } from "lucide-react"
import { useWeightUnit } from "@/hooks/use-weight-unit"

interface KeyLiftCardProps {
  exerciseName: string
  exerciseId: string
  currentBest: number | null
  allTimePR: number | null
  estimated1RM: number | null
  totalSessions: number
  recentData: Array<{ date: string; weight_kg: number }>
  onClick?: () => void
}

export function KeyLiftCard({
  exerciseName,
  currentBest,
  allTimePR,
  estimated1RM,
  totalSessions,
  recentData,
  onClick,
}: KeyLiftCardProps) {
  const { formatWeight, displayWeight, unitLabel } = useWeightUnit()
  const isPR = currentBest != null && allTimePR != null && currentBest >= allTimePR

  // Compute trend from recent data
  const trend = (() => {
    if (recentData.length < 2) return null
    const first = recentData[0].weight_kg
    const last = recentData[recentData.length - 1].weight_kg
    const diff = last - first
    const pct = first > 0 ? Math.round((diff / first) * 100) : 0
    return { diff, pct }
  })()

  const chartData = recentData.map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    weight: displayWeight(d.weight_kg) ?? 0,
    weight_kg: d.weight_kg,
  }))

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-border p-4 sm:p-5 transition-all ${
        onClick ? "cursor-pointer hover:shadow-md hover:border-primary/20" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Dumbbell className="size-4 text-primary" strokeWidth={1.5} />
          </div>
          <h3 className="text-sm font-semibold text-foreground truncate">{exerciseName}</h3>
        </div>
        {isPR && (
          <Badge variant="outline" className="shrink-0 gap-1 text-[10px] border-amber-300 bg-amber-50 text-amber-700">
            <Trophy className="size-3" />
            PR
          </Badge>
        )}
      </div>

      {/* Big number + trend */}
      <div className="flex items-end gap-3 mb-3 ml-10">
        <div>
          <p className="text-2xl font-bold text-primary leading-none">{formatWeight(currentBest)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Best weight</p>
        </div>
        {trend && trend.pct !== 0 && (
          <div
            className={`flex items-center gap-0.5 text-xs font-medium pb-0.5 ${
              trend.pct > 0 ? "text-success" : trend.pct < 0 ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {trend.pct > 0 ? (
              <TrendingUp className="size-3.5" />
            ) : trend.pct < 0 ? (
              <TrendingDown className="size-3.5" />
            ) : (
              <Minus className="size-3.5" />
            )}
            {trend.pct > 0 ? "+" : ""}
            {trend.pct}%
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-3 ml-10 text-xs">
        <div>
          <span className="text-muted-foreground">Est. 1RM </span>
          <span className="font-medium text-foreground">{formatWeight(estimated1RM)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Sessions </span>
          <span className="font-medium text-foreground">{totalSessions}</span>
        </div>
      </div>

      {/* Chart */}
      {chartData.length >= 2 ? (
        <div className="h-28 sm:h-32 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={`gradient-${exerciseName}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0E3F50" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#0E3F50" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis domain={["dataMin - 2", "dataMax + 2"]} hide />
              <Tooltip
                formatter={(value) => [`${value} ${unitLabel()}`, "Weight"]}
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 8,
                  border: "1px solid hsl(var(--border))",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  padding: "6px 10px",
                }}
                cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              {allTimePR != null && (
                <ReferenceLine
                  y={displayWeight(allTimePR) ?? 0}
                  stroke="#C49B7A"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              )}
              <Area
                type="monotone"
                dataKey="weight"
                stroke="#0E3F50"
                strokeWidth={2}
                fill={`url(#gradient-${exerciseName})`}
                dot={{ r: 3, fill: "#0E3F50", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "#0E3F50", strokeWidth: 2, stroke: "#fff" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex items-center justify-center h-20 text-xs text-muted-foreground gap-1 bg-muted/30 rounded-lg">
          <TrendingUp className="size-3" />
          Log more sessions to see your trend
        </div>
      )}
    </div>
  )
}
