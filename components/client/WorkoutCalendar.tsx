"use client"

import { useState, useMemo } from "react"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { CheckCircle2, Dumbbell } from "lucide-react"

export interface WorkoutCalendarDay {
  date: Date
  exerciseCount: number
  completedCount: number
  programName: string
  dayOfWeek: number
  weekNumber: number
}

interface WorkoutCalendarProps {
  workoutDays: WorkoutCalendarDay[]
}

// No longer needed — we show "Day N" labels now

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function WorkoutCalendar({ workoutDays }: WorkoutCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)

  // Group workout days by date string for quick lookup
  const daysByDate = useMemo(() => {
    const map = new Map<string, WorkoutCalendarDay[]>()
    for (const wd of workoutDays) {
      const key = wd.date.toISOString().slice(0, 10)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(wd)
    }
    return map
  }, [workoutDays])

  // Compute modifier date arrays
  const { completedDates, partialDates, scheduledDates } = useMemo(() => {
    const completed: Date[] = []
    const partial: Date[] = []
    const scheduled: Date[] = []

    for (const [, days] of daysByDate) {
      const totalExercises = days.reduce((s, d) => s + d.exerciseCount, 0)
      const totalCompleted = days.reduce((s, d) => s + d.completedCount, 0)
      const date = days[0].date

      if (totalCompleted >= totalExercises && totalExercises > 0) {
        completed.push(date)
      } else if (totalCompleted > 0) {
        partial.push(date)
      } else {
        scheduled.push(date)
      }
    }

    return { completedDates: completed, partialDates: partial, scheduledDates: scheduled }
  }, [daysByDate])

  // Find data for the selected day
  const selectedDayData = useMemo(() => {
    if (!selectedDate) return null
    const key = selectedDate.toISOString().slice(0, 10)
    return daysByDate.get(key) ?? null
  }, [selectedDate, daysByDate])

  return (
    <div className="space-y-4">
      {/* Calendar card */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Training Schedule</h3>
        </div>
        <div className="p-3 sm:p-4 flex justify-center">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={setSelectedDate}
            modifiers={{
              scheduled: scheduledDates,
              completed: completedDates,
              partial: partialDates,
            }}
            modifiersClassNames={{
              scheduled: "bg-primary/10 font-semibold text-primary",
              completed: "bg-success/10 font-semibold text-success",
              partial: "bg-amber-50 font-semibold text-amber-600",
            }}
          />
        </div>
        {/* Legend */}
        <div className="flex items-center justify-center gap-5 px-4 py-3 border-t border-border bg-muted/30">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2.5 rounded-full bg-primary/20 ring-1 ring-primary/30" /> Scheduled
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2.5 rounded-full bg-amber-200 ring-1 ring-amber-300" /> In Progress
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2.5 rounded-full bg-success/30 ring-1 ring-success/40" /> Complete
          </span>
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDayData ? (
        <div className="space-y-2">
          {selectedDayData.map((day) => {
            const allDone =
              day.completedCount >= day.exerciseCount && day.exerciseCount > 0
            return (
              <div
                key={`${day.programName}-${day.weekNumber}-${day.dayOfWeek}`}
                className="bg-white rounded-xl border border-border p-4"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Dumbbell className="size-4 text-primary" strokeWidth={1.5} />
                    <p className="text-sm font-semibold text-foreground">
                      {day.programName}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
                      allDone
                        ? "bg-success/10 text-success"
                        : day.completedCount > 0
                          ? "bg-amber-50 text-amber-600"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {allDone && <CheckCircle2 className="size-3" />}
                    {day.completedCount}/{day.exerciseCount}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Week {day.weekNumber}
                </p>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-muted-foreground">
            Tap a highlighted day to view details.
          </p>
        </div>
      )}
    </div>
  )
}
