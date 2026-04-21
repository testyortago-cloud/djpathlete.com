"use client"

import { useDroppable } from "@dnd-kit/core"
import { PostChip } from "./PostChip"
import { groupByHour, type CalendarChip } from "@/lib/content-studio/calendar-chips"
import { cn } from "@/lib/utils"

function hourKey(anchor: Date, hour: number): string {
  const y = anchor.getUTCFullYear()
  const m = String(anchor.getUTCMonth() + 1).padStart(2, "0")
  const d = String(anchor.getUTCDate()).padStart(2, "0")
  const h = String(hour).padStart(2, "0")
  return `${y}-${m}-${d}T${h}`
}

function HourRow({
  anchor,
  hour,
  chips,
  onEmptyDayClick,
}: {
  anchor: Date
  hour: number
  chips: CalendarChip[]
  onEmptyDayClick: (dayKey: string) => void
}) {
  const key = hourKey(anchor, hour)
  const { setNodeRef, isOver } = useDroppable({ id: `hour-${key}`, data: { hourKey: key } })
  return (
    <div
      ref={setNodeRef}
      role="row"
      className={cn(
        "grid grid-cols-[80px_1fr] border-b border-border min-h-[48px] cursor-pointer",
        isOver && "ring-2 ring-primary bg-primary/5",
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[role='button']")) return
        if (chips.length === 0) onEmptyDayClick(key.slice(0, 10))
      }}
    >
      <div className="text-[11px] text-muted-foreground px-2 py-1.5">{String(hour).padStart(2, "0")}:00</div>
      <div className="flex flex-wrap gap-1 p-1">
        {chips.map((c) => (
          <PostChip key={`${c.kind}-${c.id}`} chip={c} />
        ))}
      </div>
    </div>
  )
}

interface DayGridProps {
  anchor: Date
  chips: CalendarChip[]
  onEmptyDayClick: (dateKey: string) => void
}

export function DayGrid({ anchor, chips, onEmptyDayClick }: DayGridProps) {
  const grouped = groupByHour(chips)
  const hours = Array.from({ length: 24 }, (_, h) => h)
  return (
    <div
      className="bg-white rounded-lg border border-border overflow-hidden"
      role="grid"
      aria-label="Calendar day view"
    >
      {hours.map((h) => (
        <HourRow
          key={h}
          anchor={anchor}
          hour={h}
          chips={grouped[hourKey(anchor, h)] ?? []}
          onEmptyDayClick={onEmptyDayClick}
        />
      ))}
    </div>
  )
}
