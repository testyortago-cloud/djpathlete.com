"use client"

import { useState, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Calendar } from "@/components/ui/calendar"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  CheckCircle2,
  Dumbbell,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CalendarDays,
} from "lucide-react"

export interface WorkoutCalendarDay {
  date: Date
  exerciseCount: number
  completedCount: number
  programName: string
  dayOfWeek: number
  weekNumber: number
  exerciseNames: string[]
  muscleGroups: string[]
}

interface WorkoutCalendarProps {
  workoutDays: WorkoutCalendarDay[]
  onSwitchToList?: () => void
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// ---------- Internal: Week Strip ----------

function CalendarWeekStrip({
  selectedDate,
  onSelect,
  scheduledDates,
  completedDates,
  partialDates,
}: {
  selectedDate: Date | undefined
  onSelect: (date: Date | undefined) => void
  scheduledDates: Date[]
  completedDates: Date[]
  partialDates: Date[]
}) {
  const today = new Date()
  const reference = selectedDate ?? today

  // Monday of the week containing the reference date
  const jsDay = reference.getDay()
  const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay
  const monday = new Date(reference)
  monday.setDate(reference.getDate() + mondayOffset)

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

  function getStatus(date: Date): "completed" | "partial" | "scheduled" | null {
    if (completedDates.some((d) => isSameDay(d, date))) return "completed"
    if (partialDates.some((d) => isSameDay(d, date))) return "partial"
    if (scheduledDates.some((d) => isSameDay(d, date))) return "scheduled"
    return null
  }

  function navigateWeek(direction: -1 | 1) {
    const ref = selectedDate ?? today
    const next = new Date(ref)
    next.setDate(ref.getDate() + direction * 7)
    onSelect(next)
  }

  return (
    <div className="flex items-center px-1 py-2">
      <button
        onClick={() => navigateWeek(-1)}
        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
      </button>
      <div className="flex-1 flex items-center justify-around">
        {weekDays.map((day, i) => {
          const isSelected = selectedDate && isSameDay(day, selectedDate)
          const isToday = isSameDay(day, today)
          const status = getStatus(day)

          return (
            <button
              key={day.toISOString()}
              onClick={() => onSelect(day)}
              className={cn(
                "flex flex-col items-center gap-0.5 min-w-[36px] py-1.5 rounded-lg text-xs transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : status === "completed"
                    ? "text-success"
                    : status === "partial"
                      ? "text-amber-600"
                      : status === "scheduled"
                        ? "text-primary"
                        : "text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "text-[10px] uppercase",
                  isSelected ? "text-primary-foreground/70" : "opacity-60"
                )}
              >
                {dayNames[i]}
              </span>
              <span className="font-semibold text-sm">{day.getDate()}</span>
              {isToday && !isSelected && (
                <span className="size-1 rounded-full bg-primary" />
              )}
              {status && !isSelected && !isToday && (
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    status === "completed"
                      ? "bg-success"
                      : status === "partial"
                        ? "bg-amber-400"
                        : "bg-primary/40"
                  )}
                />
              )}
            </button>
          )
        })}
      </div>
      <button
        onClick={() => navigateWeek(1)}
        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}

// ---------- Main Component ----------

export function WorkoutCalendar({ workoutDays, onSwitchToList }: WorkoutCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date())
  const [collapsed, setCollapsed] = useState(false)

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

  const today = new Date()

  return (
    <div className="space-y-3">
      {/* Calendar card */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        {/* Legend + collapse toggle row */}
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="size-2 rounded-full bg-primary/20 ring-1 ring-primary/30" /> Scheduled
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="size-2 rounded-full bg-amber-200 ring-1 ring-amber-300" /> In Progress
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="size-2 rounded-full bg-success/30 ring-1 ring-success/40" /> Complete
            </span>
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {collapsed ? (
              <>
                <CalendarDays className="size-3.5" />
                Month
              </>
            ) : (
              <>
                <ChevronUp className="size-3.5" />
                Week
              </>
            )}
          </button>
        </div>

        {/* Calendar body */}
        <AnimatePresence mode="wait" initial={false}>
          {collapsed ? (
            <motion.div
              key="week-strip"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <CalendarWeekStrip
                selectedDate={selectedDate}
                onSelect={setSelectedDate}
                scheduledDates={scheduledDates}
                completedDates={completedDates}
                partialDates={partialDates}
              />
            </motion.div>
          ) : (
            <motion.div
              key="full-calendar"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="px-2 pb-2 flex justify-center">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  className="p-2"
                  classNames={{
                    month: "flex flex-col gap-2",
                    week: "flex w-full mt-1",
                    weekday: "text-muted-foreground rounded-md w-7 font-normal text-[0.7rem]",
                    day_button: "size-7 p-0 font-normal text-xs aria-selected:opacity-100",
                    month_caption: "flex justify-center pt-0.5 relative items-center",
                    caption_label: "text-xs font-medium",
                  }}
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Selected date header */}
      {selectedDate && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {selectedDate.toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </p>
            {isSameDay(selectedDate, today) && (
              <p className="text-[10px] text-primary font-medium">Today</p>
            )}
          </div>
          {selectedDayData && (
            <span className="text-xs text-muted-foreground">
              {selectedDayData.reduce((s, d) => s + d.exerciseCount, 0)} exercises
            </span>
          )}
        </div>
      )}

      {/* Workout detail cards */}
      {selectedDayData ? (
        <div className="space-y-3">
          {selectedDayData.map((day) => {
            const allDone =
              day.completedCount >= day.exerciseCount && day.exerciseCount > 0
            const progressPct =
              day.exerciseCount > 0
                ? Math.round((day.completedCount / day.exerciseCount) * 100)
                : 0
            const previewNames = day.exerciseNames.slice(0, 3)
            const remaining = day.exerciseNames.length - 3

            return (
              <motion.div
                key={`${day.programName}-${day.weekNumber}-${day.dayOfWeek}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className="bg-white rounded-xl border border-border p-4"
              >
                {/* Header row */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "size-8 rounded-lg flex items-center justify-center",
                        allDone ? "bg-success/10" : "bg-primary/5"
                      )}
                    >
                      {allDone ? (
                        <CheckCircle2 className="size-4 text-success" />
                      ) : (
                        <Dumbbell className="size-4 text-primary" strokeWidth={1.5} />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {day.programName}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Week {day.weekNumber} &middot; Day {day.dayOfWeek}
                      </p>
                    </div>
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

                {/* Progress bar */}
                {day.exerciseCount > 0 && (
                  <div className="mb-3">
                    <Progress
                      value={progressPct}
                      className={cn(
                        "h-1.5",
                        progressPct === 100 &&
                          "[&>[data-slot=progress-indicator]]:bg-success"
                      )}
                    />
                  </div>
                )}

                {/* Exercise name preview */}
                {previewNames.length > 0 && (
                  <div className="space-y-1 mb-3">
                    {previewNames.map((name, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <span className="size-1 rounded-full bg-border shrink-0" />
                        <span className="truncate">{name}</span>
                      </div>
                    ))}
                    {remaining > 0 && (
                      <p className="text-[10px] text-muted-foreground/60 pl-3">
                        +{remaining} more
                      </p>
                    )}
                  </div>
                )}

                {/* Muscle group tags */}
                {day.muscleGroups.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {day.muscleGroups.map((mg) => (
                      <span
                        key={mg}
                        className="rounded-full bg-primary/5 text-primary px-2 py-0.5 text-[10px] font-medium capitalize"
                      >
                        {mg}
                      </span>
                    ))}
                  </div>
                )}

                {/* CTA button */}
                {!allDone && onSwitchToList && (
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs"
                    variant={day.completedCount > 0 ? "outline" : "default"}
                    onClick={onSwitchToList}
                  >
                    {day.completedCount > 0 ? "Continue Workout" : "Start Workout"}
                    <ChevronRight className="size-3.5 ml-1" />
                  </Button>
                )}
              </motion.div>
            )
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border p-5 text-center">
          <CalendarDays className="size-5 text-muted-foreground/40 mx-auto mb-1.5" />
          <p className="text-xs text-muted-foreground">
            Tap a highlighted day to view your workout.
          </p>
        </div>
      )}
    </div>
  )
}
