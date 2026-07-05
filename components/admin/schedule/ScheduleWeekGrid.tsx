"use client"

import { weekDays, hourRange, assignLanes, timeToMinutes } from "@/lib/schedule-calendar"
import { SessionChip, type CalendarSession } from "@/components/admin/schedule/SessionChip"

const PX_PER_HOUR = 48

function dayLabel(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })
  return `${weekday} ${Number(date.slice(8))}`
}

/** Days across, times down; sessions as positioned blocks in their time slot. */
export function ScheduleWeekGrid({
  anchor,
  sessions,
  today,
}: {
  anchor: string
  sessions: CalendarSession[]
  today: string
}) {
  const days = weekDays(anchor)
  const inWeek = sessions.filter((s) => days.includes(s.session_date))
  const { startHour, endHour } = hourRange(inWeek)
  const gridStartMin = startHour * 60
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const bodyHeight = hours.length * PX_PER_HOUR

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border">
          <div />
          {days.map((date) => (
            <div
              key={date}
              data-testid="day-header"
              aria-current={date === today ? "date" : undefined}
              className={`border-l border-border px-2 py-2 text-center text-xs font-semibold ${
                date === today ? "bg-primary/5 text-primary" : "text-foreground"
              }`}
            >
              {dayLabel(date)}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
          <div style={{ height: bodyHeight }}>
            {hours.map((h) => (
              <div
                key={h}
                style={{ height: PX_PER_HOUR }}
                className="pr-1.5 text-right font-mono text-[10px] leading-none text-muted-foreground"
              >
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {days.map((date) => {
            const daySessions = inWeek
              .filter((s) => s.session_date === date)
              .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))
            const lanes = assignLanes(daySessions)
            return (
              <div
                key={date}
                className={`relative border-l border-border ${date === today ? "bg-primary/5" : ""}`}
                style={{ height: bodyHeight }}
              >
                {hours.map((h) => (
                  <div key={h} style={{ height: PX_PER_HOUR }} className="border-b border-border/40" />
                ))}
                {daySessions.map((s) => {
                  const lane = lanes.get(s.id) ?? { lane: 0, lanes: 1 }
                  const top = ((timeToMinutes(s.start_time) - gridStartMin) / 60) * PX_PER_HOUR
                  const height = Math.max((s.duration_minutes / 60) * PX_PER_HOUR, 22)
                  return (
                    <div
                      key={s.id}
                      data-testid="session-block"
                      className="absolute p-px"
                      style={{
                        top,
                        height,
                        left: `${(lane.lane / lane.lanes) * 100}%`,
                        width: `${100 / lane.lanes}%`,
                      }}
                    >
                      <SessionChip session={s} variant="block" />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
