"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useEffect, useCallback } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

type View = "month" | "week" | "day"

function resolveView(raw: string | null): View {
  if (raw === "week" || raw === "day") return raw
  return "month"
}

function anchorOrToday(raw: string | null): Date {
  if (raw) {
    const d = new Date(`${raw}T00:00:00Z`)
    if (!Number.isNaN(d.getTime())) return d
  }
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  return today
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function shift(date: Date, view: View, direction: 1 | -1): Date {
  const d = new Date(date)
  if (view === "month") d.setUTCMonth(d.getUTCMonth() + direction)
  else if (view === "week") d.setUTCDate(d.getUTCDate() + 7 * direction)
  else d.setUTCDate(d.getUTCDate() + direction)
  return d
}

export function CalendarViewToggle() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = resolveView(searchParams.get("view"))
  const anchor = anchorOrToday(searchParams.get("anchor"))

  const update = useCallback(
    (patch: { view?: View; anchor?: Date }) => {
      const params = new URLSearchParams(searchParams.toString())
      if (patch.view) params.set("view", patch.view)
      if (patch.anchor) params.set("anchor", isoDate(patch.anchor))
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const isTypingTarget = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable
  }, [])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case "m":
          update({ view: "month" })
          break
        case "w":
          update({ view: "week" })
          break
        case "d":
          update({ view: "day" })
          break
        case "t": {
          const today = new Date()
          today.setUTCHours(0, 0, 0, 0)
          update({ anchor: today })
          break
        }
        case "ArrowLeft":
          update({ anchor: shift(anchor, view, -1) })
          break
        case "ArrowRight":
          update({ anchor: shift(anchor, view, 1) })
          break
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [anchor, view, update, isTypingTarget])

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        aria-label="Previous period"
        onClick={() => update({ anchor: shift(anchor, view, -1) })}
        className="p-1.5 rounded border border-border hover:bg-surface/40"
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => {
          const today = new Date()
          today.setUTCHours(0, 0, 0, 0)
          update({ anchor: today })
        }}
        className="text-xs px-3 py-1.5 rounded border border-border hover:bg-surface/40"
      >
        Today
      </button>
      <button
        type="button"
        aria-label="Next period"
        onClick={() => update({ anchor: shift(anchor, view, 1) })}
        className="p-1.5 rounded border border-border hover:bg-surface/40"
      >
        <ChevronRight className="size-4" />
      </button>
      <div className="ml-2 inline-flex rounded-md border border-border overflow-hidden">
        {(["month", "week", "day"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => update({ view: v })}
            className={cn(
              "text-xs px-3 py-1.5 capitalize transition",
              view === v
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-surface/40",
            )}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}
