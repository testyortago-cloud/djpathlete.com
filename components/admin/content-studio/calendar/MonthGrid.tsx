"use client"

import { useDroppable } from "@dnd-kit/core"
import { PostChip } from "./PostChip"
import { groupByDay, type CalendarChip, dayKey } from "@/lib/content-studio/calendar-chips"
import { cn } from "@/lib/utils"

interface MonthGridProps {
  anchor: Date
  chips: CalendarChip[]
  onEmptyDayClick: (dateKey: string) => void
}

function startOfMonthGrid(anchor: Date): Date {
  const d = new Date(anchor)
  d.setUTCDate(1)
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

function sameYearMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
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
  isInMonth,
  chips,
  onEmptyClick,
}: {
  day: Date
  isInMonth: boolean
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
      data-today={today || undefined}
      className={cn(
        "min-h-[110px] border border-border p-1.5 flex flex-col text-left cursor-pointer",
        !isInMonth && "bg-muted/30 text-muted-foreground/60",
        isOver && "ring-2 ring-primary bg-primary/5",
        today && "bg-accent/5",
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[role='button']")) return
        if (chips.length === 0) onEmptyClick(key)
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span
          className={cn(
            "text-xs font-semibold",
            today ? "text-accent" : isInMonth ? "text-primary" : "text-muted-foreground/60",
          )}
        >
          {day.getUTCDate()}
        </span>
      </div>
      <div className="flex flex-col gap-1 overflow-hidden">
        {chips.slice(0, 3).map((c) => (
          <PostChip key={`${c.kind}-${c.id}`} chip={c} />
        ))}
        {chips.length > 3 && (
          <span className="text-[10px] text-muted-foreground">+{chips.length - 3} more</span>
        )}
      </div>
    </div>
  )
}

export function MonthGrid({ anchor, chips, onEmptyDayClick }: MonthGridProps) {
  const start = startOfMonthGrid(anchor)
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  const grouped = groupByDay(chips)

  return (
    <div
      className="bg-white rounded-lg border border-border overflow-hidden"
      role="grid"
      aria-label="Calendar month view"
    >
      <div className="grid grid-cols-7 bg-surface/40 text-xs text-muted-foreground uppercase tracking-wide">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-2 text-center font-semibold">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => (
          <DayCell
            key={day.toISOString()}
            day={day}
            isInMonth={sameYearMonth(day, anchor)}
            chips={grouped[dayKey(day)] ?? []}
            onEmptyClick={onEmptyDayClick}
          />
        ))}
      </div>
    </div>
  )
}
