"use client"

import { ResponsiveContainer, LineChart, Line } from "recharts"
import { Badge } from "@/components/ui/badge"
import { Trophy, TrendingUp } from "lucide-react"
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
  const { formatWeight, displayWeight } = useWeightUnit()
  const isPR = currentBest != null && allTimePR != null && currentBest >= allTimePR

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-border p-4 transition-all ${
        onClick ? "cursor-pointer hover:shadow-md hover:border-primary/20" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-foreground truncate">
          {exerciseName}
        </h3>
        {isPR && (
          <Badge
            variant="outline"
            className="shrink-0 gap-1 text-[10px] border-amber-300 bg-amber-50 text-amber-700"
          >
            <Trophy className="size-3" />
            PR
          </Badge>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <p className="text-xs text-muted-foreground">Current Best</p>
          <p className="text-lg font-semibold text-primary">
            {formatWeight(currentBest)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">All-Time PR</p>
          <p className="text-lg font-semibold text-primary">
            {formatWeight(allTimePR)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Est. 1RM</p>
          <p className="text-sm font-medium text-foreground">
            {formatWeight(estimated1RM)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Sessions</p>
          <p className="text-sm font-medium text-foreground">
            {totalSessions}
          </p>
        </div>
      </div>

      {/* Sparkline */}
      {recentData.length >= 2 ? (
        <div className="h-12">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={recentData.map((d) => ({ ...d, weight: displayWeight(d.weight_kg) ?? 0 }))}>
              <Line
                type="monotone"
                dataKey="weight"
                stroke="#0E3F50"
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex items-center justify-center h-12 text-xs text-muted-foreground gap-1">
          <TrendingUp className="size-3" />
          Not enough data for trend
        </div>
      )}
    </div>
  )
}
