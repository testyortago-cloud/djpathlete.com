"use client"

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts"
import { TrendingUp } from "lucide-react"
import { useWeightUnit } from "@/hooks/use-weight-unit"

interface ProgressDataPoint {
  date: string
  weight_kg: number | null
  reps: number | null
  estimated_1rm: number | null
  is_pr: boolean
}

interface ProgressChartProps {
  data: ProgressDataPoint[]
  metric: "weight" | "estimated_1rm" | "volume"
  exerciseName: string
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function getMetricKey(metric: ProgressChartProps["metric"]): string {
  switch (metric) {
    case "weight":
      return "weight"
    case "estimated_1rm":
      return "estimated_1rm"
    case "volume":
      return "volume"
    default:
      return "weight"
  }
}

function getMetricLabel(metric: ProgressChartProps["metric"], unit: string): string {
  switch (metric) {
    case "weight":
      return `Weight (${unit})`
    case "estimated_1rm":
      return `Est. 1RM (${unit})`
    case "volume":
      return `Volume (${unit})`
    default:
      return `Weight (${unit})`
  }
}

interface ChartDataPoint {
  date: string
  formattedDate: string
  weight: number | null
  reps: number | null
  estimated_1rm: number | null
  volume: number | null
  is_pr: boolean
}

function CustomTooltip({
  active,
  payload,
  unitLabel,
}: {
  active?: boolean
  payload?: Array<{ payload: ChartDataPoint }>
  label?: string
  unitLabel: string
}) {
  if (!active || !payload || payload.length === 0) return null

  const data = payload[0].payload

  return (
    <div className="rounded-lg border border-border bg-white p-3 shadow-md">
      <p className="text-xs font-medium text-foreground mb-1">
        {data.formattedDate}
      </p>
      {data.weight != null && (
        <p className="text-xs text-muted-foreground">
          Weight: <span className="font-medium text-foreground">{data.weight} {unitLabel}</span>
        </p>
      )}
      {data.reps != null && (
        <p className="text-xs text-muted-foreground">
          Reps: <span className="font-medium text-foreground">{data.reps}</span>
        </p>
      )}
      {data.estimated_1rm != null && (
        <p className="text-xs text-muted-foreground">
          Est. 1RM: <span className="font-medium text-foreground">{data.estimated_1rm} {unitLabel}</span>
        </p>
      )}
      {data.is_pr && (
        <p className="text-xs font-semibold text-amber-600 mt-1">
          Personal Record!
        </p>
      )}
    </div>
  )
}

interface DotProps {
  cx?: number
  cy?: number
  payload?: ChartDataPoint
}

function PRDot({ cx, cy, payload }: DotProps) {
  if (!payload?.is_pr || cx == null || cy == null) return null
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill="#C49B7A"
      stroke="#fff"
      strokeWidth={2}
    />
  )
}

export function ProgressChart({ data, metric, exerciseName }: ProgressChartProps) {
  const { displayWeight, unitLabel } = useWeightUnit()

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex items-center justify-center size-12 rounded-full bg-primary/10 mb-3">
          <TrendingUp className="size-6 text-primary" strokeWidth={1.5} />
        </div>
        <p className="text-sm text-muted-foreground">
          No data yet for {exerciseName}
        </p>
      </div>
    )
  }

  const chartData: ChartDataPoint[] = data
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((d) => {
      const w = displayWeight(d.weight_kg)
      const e1rm = displayWeight(d.estimated_1rm)
      return {
        date: d.date,
        formattedDate: formatDate(d.date),
        weight: w,
        reps: d.reps,
        estimated_1rm: e1rm,
        volume:
          w != null && d.reps != null
            ? Math.round(w * d.reps)
            : null,
        is_pr: d.is_pr,
      }
    })

  const metricKey = getMetricKey(metric)
  const metricLabel = getMetricLabel(metric, unitLabel())

  return (
    <div className="w-full">
      <p className="text-xs text-muted-foreground mb-2">{metricLabel}</p>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.91 0.005 250 / 0.5)" />
          <XAxis
            dataKey="formattedDate"
            tick={{ fontSize: 11, fill: "oklch(0.50 0.01 250)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "oklch(0.50 0.01 250)" }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip content={<CustomTooltip unitLabel={unitLabel()} />} />
          <Line
            type="monotone"
            dataKey={metricKey}
            stroke="#0E3F50"
            strokeWidth={2}
            dot={<PRDot />}
            activeDot={{ r: 6, fill: "#0E3F50", stroke: "#fff", strokeWidth: 2 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
