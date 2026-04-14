"use client"

import { useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const PRESETS = [
  { label: "1M", value: 1 },
  { label: "3M", value: 3 },
  { label: "6M", value: 6 },
  { label: "1Y", value: 12 },
  { label: "All", value: 0 },
] as const

interface DateRangePickerProps {
  currentMonths: number
  customFrom?: string
  customTo?: string
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

export function DateRangePicker({ currentMonths, customFrom, customTo }: DateRangePickerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isCustom = Boolean(customFrom && customTo)

  const [calendarRange, setCalendarRange] = useState<DateRange | undefined>(
    customFrom && customTo ? { from: new Date(customFrom), to: new Date(customTo) } : undefined,
  )
  const [open, setOpen] = useState(false)

  function navigateWithParams(params: Record<string, string>) {
    const sp = new URLSearchParams()
    // Preserve tab
    const tab = searchParams.get("tab")
    if (tab) sp.set("tab", tab)
    for (const [k, v] of Object.entries(params)) {
      sp.set(k, v)
    }
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  function handlePreset(months: number) {
    const params: Record<string, string> = {}
    if (months !== 6) params.months = String(months)
    navigateWithParams(params)
  }

  function handleApplyCustom() {
    if (!calendarRange?.from || !calendarRange?.to) return
    const from = calendarRange.from.toISOString().split("T")[0]
    const to = calendarRange.to.toISOString().split("T")[0]
    navigateWithParams({ from, to })
    setOpen(false)
  }

  const customLabel =
    isCustom && customFrom && customTo
      ? `${formatShortDate(new Date(customFrom))} – ${formatShortDate(new Date(customTo))}`
      : "Custom"

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-border bg-surface/50 p-1">
        {PRESETS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => handlePreset(r.value)}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-md transition-colors",
              !isCustom && currentMonths === r.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-surface",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "gap-1.5 text-xs",
              isCustom && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
            )}
          >
            <CalendarIcon className="size-3.5" />
            {customLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            defaultMonth={calendarRange?.from ?? new Date()}
            selected={calendarRange}
            onSelect={setCalendarRange}
            numberOfMonths={2}
            disabled={{ after: new Date() }}
          />
          <div className="flex items-center justify-end gap-2 p-3 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCalendarRange(undefined)
                setOpen(false)
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleApplyCustom} disabled={!calendarRange?.from || !calendarRange?.to}>
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
