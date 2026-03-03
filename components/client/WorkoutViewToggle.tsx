"use client"

import { useState } from "react"
import { List, CalendarDays } from "lucide-react"
import { cn } from "@/lib/utils"
import { WorkoutTabs } from "@/components/client/WorkoutTabs"
import { WorkoutCalendar } from "@/components/client/WorkoutCalendar"
import type { WorkoutCalendarDay } from "@/components/client/WorkoutCalendar"

type WorkoutTabsProps = Parameters<typeof WorkoutTabs>[0]

interface WorkoutViewToggleProps {
  tabsProps: WorkoutTabsProps
  calendarDays: WorkoutCalendarDay[]
}

export function WorkoutViewToggle({
  tabsProps,
  calendarDays,
}: WorkoutViewToggleProps) {
  const [view, setView] = useState<"list" | "calendar">("list")

  return (
    <>
      <div className="flex items-center gap-1 bg-white rounded-lg border border-border p-1 mb-4 w-fit">
        <button
          onClick={() => setView("list")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            view === "list"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <List className="size-3.5" />
          List
        </button>
        <button
          onClick={() => setView("calendar")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            view === "calendar"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <CalendarDays className="size-3.5" />
          Calendar
        </button>
      </div>

      {view === "list" ? (
        <WorkoutTabs {...tabsProps} />
      ) : (
        <WorkoutCalendar workoutDays={calendarDays} onSwitchToList={() => setView("list")} />
      )}
    </>
  )
}
