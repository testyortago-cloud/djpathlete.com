"use client"

import { Trophy } from "lucide-react"
import { useWeightUnit } from "@/hooks/use-weight-unit"

interface ActivityEntry {
  id: string
  exercise_name: string
  sets_completed: number | null
  reps_completed: string | null
  weight_kg: number | null
  duration_seconds: number | null
  rpe: number | null
  is_pr: boolean
  completed_at: string
}

export function RecentActivity({ entries }: { entries: ActivityEntry[] }) {
  const { formatWeightCompact } = useWeightUnit()

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="divide-y divide-border">
        {entries.map((entry) => {
          const date = new Date(entry.completed_at)
          const formattedDate = date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })

          const parts: string[] = []
          if (entry.sets_completed && entry.reps_completed) {
            parts.push(`${entry.sets_completed}x${entry.reps_completed}`)
          }
          if (entry.weight_kg) {
            parts.push(formatWeightCompact(entry.weight_kg))
          }
          if (entry.duration_seconds) {
            const mins = Math.floor(entry.duration_seconds / 60)
            const secs = entry.duration_seconds % 60
            parts.push(
              mins > 0
                ? `${mins}m${secs > 0 ? ` ${secs}s` : ""}`
                : `${secs}s`
            )
          }
          if (entry.rpe) {
            parts.push(`RPE ${entry.rpe}`)
          }

          return (
            <div
              key={entry.id}
              className="px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-medium text-foreground text-xs sm:text-sm truncate">
                    {entry.exercise_name}
                  </p>
                  {entry.is_pr && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] sm:text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1 sm:px-1.5 py-0.5 shrink-0">
                      <Trophy className="size-2.5" />
                      PR
                    </span>
                  )}
                </div>
                {parts.length > 0 && (
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                    {parts.join(" · ")}
                  </p>
                )}
              </div>
              <span className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap shrink-0">
                {formattedDate}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
