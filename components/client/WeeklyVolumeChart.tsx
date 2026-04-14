"use client"

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"

interface WeeklyVolumeChartProps {
  data: Array<{ week: string; workouts: number; sets: number }>
}

export function WeeklyVolumeChart({ data }: WeeklyVolumeChartProps) {
  if (data.length === 0) return null

  const maxWorkouts = Math.max(...data.map((d) => d.workouts))

  return (
    <div className="bg-white rounded-xl border border-border p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Weekly Volume</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Workouts per week</p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-primary" />
            Workouts
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-accent" />
            Sets
          </span>
        </div>
      </div>
      <div className="h-48 sm:h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis
              dataKey="week"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              domain={[0, Math.max(maxWorkouts + 1, 5)]}
              yAxisId="workouts"
            />
            <YAxis
              yAxisId="sets"
              orientation="right"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: "1px solid hsl(var(--border))",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              }}
              cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
            />
            <Bar yAxisId="workouts" dataKey="workouts" fill="#0E3F50" radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar yAxisId="sets" dataKey="sets" fill="#C49B7A" radius={[4, 4, 0, 0]} maxBarSize={28} opacity={0.7} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
