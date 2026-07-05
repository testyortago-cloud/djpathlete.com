"use client"

import { monthGrid, timeToMinutes } from "@/lib/schedule-calendar"
import { SessionChip, type CalendarSession } from "@/components/admin/schedule/SessionChip"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** Classic month calendar: day cells with compact session chips. */
export function ScheduleMonthGrid({
  anchor,
  sessions,
  today,
}: {
  anchor: string
  sessions: CalendarSession[]
  today: string
}) {
  const weeks = monthGrid(anchor)
  const byDate = new Map<string, CalendarSession[]>()
  for (const s of sessions) {
    const list = byDate.get(s.session_date)
    if (list) list.push(s)
    else byDate.set(s.session_date, [s])
  }
  for (const list of byDate.values()) list.sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-foreground">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className={`grid grid-cols-7 ${wi > 0 ? "border-t border-border" : ""}`}>
            {week.map((cell) => {
              const daySessions = byDate.get(cell.date) ?? []
              const isToday = cell.date === today
              return (
                <div
                  key={cell.date}
                  data-testid="month-cell"
                  data-inmonth={cell.inMonth ? "true" : "false"}
                  aria-current={isToday ? "date" : undefined}
                  className={`min-h-24 space-y-1 border-l border-border p-1.5 first:border-l-0 ${
                    cell.inMonth ? "bg-white" : "bg-muted/40"
                  } ${isToday ? "bg-primary/5" : ""}`}
                >
                  <p
                    className={`text-right text-xs leading-none ${
                      isToday
                        ? "font-bold text-primary"
                        : cell.inMonth
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                    }`}
                  >
                    {Number(cell.date.slice(8))}
                  </p>
                  {daySessions.map((s) => (
                    <SessionChip key={s.id} session={s} />
                  ))}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
