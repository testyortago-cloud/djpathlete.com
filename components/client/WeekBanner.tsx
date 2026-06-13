"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"

/**
 * Prominent "which week am I on" banner. When the client is viewing a week that
 * isn't their current week (e.g. they scrolled back to Week 1 after finishing it),
 * it warns them and offers a one-tap jump — the main guard against accidentally
 * repeating an already-completed week.
 */
export function WeekBanner({
  selectedWeek,
  currentWeek,
  totalWeeks,
  onJumpToCurrent,
}: {
  selectedWeek: number
  currentWeek: number
  totalWeeks: number
  onJumpToCurrent: () => void
}) {
  const onCurrent = selectedWeek === currentWeek

  return (
    <div
      className={cn(
        "mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3",
        onCurrent ? "border-primary/20 bg-primary/5" : "border-warning/40 bg-warning/5",
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">
          {onCurrent ? "You're on" : "Viewing"} Week {selectedWeek}
          <span className="font-normal text-muted-foreground"> of {totalWeeks}</span>
        </p>
        {onCurrent ? (
          <p className="mt-0.5 text-[11px] font-medium text-primary">This is your current week</p>
        ) : (
          <p className="mt-0.5 text-xs font-medium text-warning">
            This isn&apos;t your current week — you&apos;re up to Week {currentWeek}.
          </p>
        )}
      </div>
      {!onCurrent && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1 text-xs"
          onClick={onJumpToCurrent}
        >
          Go to Week {currentWeek}
          <ArrowRight className="size-3" />
        </Button>
      )}
    </div>
  )
}
