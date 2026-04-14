"use client"

import { useMemo } from "react"
import { cn } from "@/lib/utils"

interface WorkoutHeatmapProps {
  /** Map of "YYYY-MM-DD" → number of exercises logged that day */
  data: Record<string, number>
  /** How many weeks to show (default 12) */
  weeks?: number
}

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""]

function getIntensity(count: number): string {
  if (count === 0) return "bg-muted"
  if (count <= 2) return "bg-primary/20"
  if (count <= 5) return "bg-primary/40"
  if (count <= 10) return "bg-primary/65"
  return "bg-primary"
}

export function WorkoutHeatmap({ data, weeks = 12 }: WorkoutHeatmapProps) {
  const grid = useMemo(() => {
    const today = new Date()
    const dayOfWeek = today.getDay() // 0=Sun
    // Start from the beginning of the grid (weeks ago, aligned to Sunday)
    const totalDays = weeks * 7 + dayOfWeek + 1
    const startDate = new Date(today)
    startDate.setDate(today.getDate() - totalDays + 1)

    const columns: Array<Array<{ date: string; count: number; dayOfMonth: number }>> = []
    let currentWeek: Array<{ date: string; count: number; dayOfMonth: number }> = []

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate)
      d.setDate(startDate.getDate() + i)
      const key = d.toISOString().split("T")[0]
      const dow = d.getDay()

      if (dow === 0 && currentWeek.length > 0) {
        columns.push(currentWeek)
        currentWeek = []
      }

      currentWeek.push({
        date: key,
        count: data[key] ?? 0,
        dayOfMonth: d.getDate(),
      })
    }
    if (currentWeek.length > 0) columns.push(currentWeek)

    return columns
  }, [data, weeks])

  // Month labels
  const monthLabels = useMemo(() => {
    const labels: Array<{ label: string; colIndex: number }> = []
    let lastMonth = -1
    grid.forEach((week, colIdx) => {
      const firstDay = week[0]
      if (!firstDay) return
      const d = new Date(firstDay.date)
      const month = d.getMonth()
      if (month !== lastMonth) {
        lastMonth = month
        labels.push({
          label: d.toLocaleDateString("en-US", { month: "short" }),
          colIndex: colIdx,
        })
      }
    })
    return labels
  }, [grid])

  const totalWorkouts = Object.values(data).filter((v) => v > 0).length

  return (
    <div className="bg-white rounded-xl border border-border p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Activity</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalWorkouts} active days in the last {weeks} weeks
          </p>
        </div>
      </div>

      <div className="overflow-x-auto -mx-1 px-1 scrollbar-none">
        {/* Month labels */}
        <div className="flex ml-7 mb-1 gap-0">
          {monthLabels.map((m, i) => (
            <span
              key={i}
              className="text-[10px] text-muted-foreground"
              style={{
                position: "relative",
                left: m.colIndex * 14,
                marginRight: i < monthLabels.length - 1 ? (monthLabels[i + 1].colIndex - m.colIndex) * 14 - 24 : 0,
              }}
            >
              {m.label}
            </span>
          ))}
        </div>

        <div className="flex gap-0">
          {/* Day labels */}
          <div className="flex flex-col gap-[3px] mr-1.5 shrink-0">
            {DAY_LABELS.map((label, i) => (
              <span key={i} className="text-[9px] text-muted-foreground h-[11px] leading-[11px] w-5 text-right">
                {label}
              </span>
            ))}
          </div>

          {/* Grid */}
          <div className="flex gap-[3px]">
            {grid.map((week, colIdx) => (
              <div key={colIdx} className="flex flex-col gap-[3px]">
                {week.map((day) => (
                  <div
                    key={day.date}
                    className={cn("size-[11px] rounded-[2px] transition-colors", getIntensity(day.count))}
                    title={`${day.date}: ${day.count} exercise${day.count !== 1 ? "s" : ""}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1 mt-3">
        <span className="text-[9px] text-muted-foreground mr-1">Less</span>
        <div className="size-[9px] rounded-[2px] bg-muted" />
        <div className="size-[9px] rounded-[2px] bg-primary/20" />
        <div className="size-[9px] rounded-[2px] bg-primary/40" />
        <div className="size-[9px] rounded-[2px] bg-primary/65" />
        <div className="size-[9px] rounded-[2px] bg-primary" />
        <span className="text-[9px] text-muted-foreground ml-1">More</span>
      </div>
    </div>
  )
}
