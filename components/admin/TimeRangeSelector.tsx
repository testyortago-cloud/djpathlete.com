"use client"

import { useRouter, usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const RANGES = [
  { label: "1M", value: 1 },
  { label: "3M", value: 3 },
  { label: "6M", value: 6 },
  { label: "1Y", value: 12 },
  { label: "All", value: 0 },
] as const

interface TimeRangeSelectorProps {
  currentMonths: number
}

export function TimeRangeSelector({ currentMonths }: TimeRangeSelectorProps) {
  const router = useRouter()
  const pathname = usePathname()

  function handleSelect(months: number) {
    const params = new URLSearchParams()
    if (months !== 6) params.set("months", String(months))
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-surface/50 p-1">
      {RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          onClick={() => handleSelect(r.value)}
          className={cn(
            "px-3 py-1 text-xs font-medium rounded-md transition-colors",
            currentMonths === r.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-surface"
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}
