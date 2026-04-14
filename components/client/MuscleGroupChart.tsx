"use client"

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts"

const MUSCLE_COLORS: Record<string, string> = {
  chest: "#ef4444",
  pectorals: "#ef4444",
  back: "#3b82f6",
  lats: "#3b82f6",
  traps: "#3b82f6",
  legs: "#22c55e",
  quadriceps: "#22c55e",
  quads: "#22c55e",
  hamstrings: "#16a34a",
  calves: "#15803d",
  glutes: "#ec4899",
  shoulders: "#8b5cf6",
  deltoids: "#8b5cf6",
  delts: "#8b5cf6",
  biceps: "#f97316",
  triceps: "#fb923c",
  arms: "#f97316",
  forearms: "#fdba74",
  core: "#eab308",
  abs: "#eab308",
  abdominals: "#eab308",
  "full body": "#0E3F50",
  "hip flexors": "#ec4899",
}

function getColor(group: string): string {
  return MUSCLE_COLORS[group.toLowerCase().trim()] ?? "#94a3b8"
}

interface MuscleGroupChartProps {
  data: Array<{ name: string; value: number }>
}

export function MuscleGroupChart({ data }: MuscleGroupChartProps) {
  if (data.length === 0) return null

  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="bg-white rounded-xl border border-border p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">Muscle Groups</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Training distribution</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="size-36 sm:size-44 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={2}
                dataKey="value"
                strokeWidth={0}
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={getColor(entry.name)} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [`${value} sets (${Math.round((Number(value) / total) * 100)}%)`, ""]}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid hsl(var(--border))",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-1.5 overflow-hidden">
          {data.slice(0, 6).map((entry) => (
            <div key={entry.name} className="flex items-center gap-2">
              <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: getColor(entry.name) }} />
              <span className="text-xs text-foreground capitalize truncate flex-1">{entry.name}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {Math.round((entry.value / total) * 100)}%
              </span>
            </div>
          ))}
          {data.length > 6 && <p className="text-[10px] text-muted-foreground pl-4.5">+{data.length - 6} more</p>}
        </div>
      </div>
    </div>
  )
}
