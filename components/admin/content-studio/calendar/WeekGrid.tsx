"use client"

import { useDroppable } from "@dnd-kit/core"
import { PostChip } from "./PostChip"
import { groupByDay, dayKey, type CalendarChip } from "@/lib/content-studio/calendar-chips"
import { cn } from "@/lib/utils"

function startOfWeek(anchor: Date): Date {
  const d = new Date(anchor)
  const dow = d.getUTCDay()
  const offset = (dow + 6) % 7
  d.setUTCDate(d.getUTCDate() - offset)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

function isTodayUTC(d: Date): boolean {
  const now = new Date()
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  )
}

function DayCell({
  day,
  chips,
  onEmptyClick,
}: {
  day: Date
  chips: CalendarChip[]
  onEmptyClick: (dayKey: string) => void
}) {
  const key = dayKey(day)
  const { setNodeRef, isOver } = useDroppable({ id: `day-${key}`, data: { dayKey: key } })
  const today = isTodayUTC(day)
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      className={cn(
        "min-h-[360px] border border-border p-2 flex flex-col cursor-pointer",
        isOver && "ring-2 ring-primary bg-primary/5",
        today && "bg-accent/5",
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[role='button']")) return
        if (chips.length === 0) onEmptyClick(key)
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {day.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}
          </div>
          <div className={cn("text-lg font-semibold", today ? "text-accent" : "text-primary")}>
            {day.getUTCDate()}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1 flex-1 overflow-y-auto">
        {chips.map((c) => (
          <PostChip key={`${c.kind}-${c.id}`} chip={c} />
        ))}
      </div>
    </div>
  )
}

interface WeekGridProps {
  anchor: Date
  chips: CalendarChip[]
  onEmptyDayClick: (dateKey: string) => void
}

export function WeekGrid({ anchor, chips, onEmptyDayClick }: WeekGridProps) {
  const start = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const grouped = groupByDay(chips)
  return (
    <div
      className="grid grid-cols-7 gap-0 bg-white rounded-lg border border-border overflow-hidden"
      role="grid"
      aria-label="Calendar week view"
    >
      {days.map((d) => (
        <DayCell
          key={d.toISOString()}
          day={d}
          chips={grouped[dayKey(d)] ?? []}
          onEmptyClick={onEmptyDayClick}
        />
      ))}
    </div>
  )
}
