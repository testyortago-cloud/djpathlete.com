"use client"

import { useState, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { toast } from "sonner"
import { CalendarViewToggle } from "./CalendarViewToggle"
import { MonthGrid } from "./MonthGrid"
import { WeekGrid } from "./WeekGrid"
import { DayGrid } from "./DayGrid"
import { UnscheduledPanel } from "./UnscheduledPanel"
import { LeftFilters } from "./LeftFilters"
import { ManualPostDialog } from "./ManualPostDialog"
import { TimePickerPopover } from "./TimePickerPopover"
import type { CalendarData } from "@/lib/content-studio/calendar-data"
import type { CalendarChip } from "@/lib/content-studio/calendar-chips"
import { applyFilters, parseFilters } from "@/lib/content-studio/pipeline-filters"
import type { SocialPlatform, VideoUpload } from "@/types/database"

interface CalendarContainerProps {
  data: CalendarData
  videos: VideoUpload[]
}

type View = "month" | "week" | "day"
function resolveView(raw: string | null): View {
  if (raw === "week" || raw === "day") return raw
  return "month"
}
function resolveAnchor(raw: string | null): Date {
  if (raw) {
    const d = new Date(`${raw}T00:00:00Z`)
    if (!Number.isNaN(d.getTime())) return d
  }
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  return today
}

export function CalendarContainer({ data, videos }: CalendarContainerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const view = resolveView(searchParams.get("view"))
  const anchor = resolveAnchor(searchParams.get("anchor"))

  const [manualPostDay, setManualPostDay] = useState<string | null>(null)
  const [pendingDrop, setPendingDrop] = useState<{ postId: string; platform: SocialPlatform; dayKey: string } | null>(
    null,
  )
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const filters = useMemo(() => parseFilters(searchParams), [searchParams])

  const chipsFiltered = useMemo(() => {
    const postChips = data.chips.filter((c): c is Extract<CalendarChip, { kind: "post" }> => c.kind === "post")
    const entryChips = data.chips.filter((c) => c.kind === "entry")
    const fakePosts = postChips.map((c) => c.raw)
    const { posts: afterFilter } = applyFilters([], fakePosts, filters)
    const kept = new Set(afterFilter.map((p) => p.id))
    return [...postChips.filter((c) => kept.has(c.id)), ...entryChips]
  }, [data.chips, filters])

  async function rescheduleExistingChip(chipId: string, dayKey: string) {
    const match = chipId.match(/^chip-(post|entry)-(.+)$/)
    if (!match) return
    const kind = match[1]
    const id = match[2]

    if (kind === "entry") {
      // /api/admin/calendar/[id] PATCH doesn't exist yet — Phase 5 will
      // add it. Graceful fallback per the plan.
      toast.info("Calendar-entry reschedule is coming in Phase 5.")
      return
    }

    const chip = data.chips.find((c) => c.kind === "post" && c.id === id)
    if (!chip || chip.kind !== "post" || !chip.scheduledAt) {
      toast.error("Missing scheduled time for this post")
      return
    }
    const original = chip.scheduledAt
    const next = new Date(`${dayKey}T00:00:00Z`)
    next.setUTCHours(original.getUTCHours(), original.getUTCMinutes(), 0, 0)
    if (next.getTime() <= Date.now()) {
      toast.error("Cannot reschedule to the past")
      return
    }
    const res = await fetch(`/api/admin/social/posts/${id}/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduled_at: next.toISOString() }),
    })
    if (!res.ok) {
      toast.error("Reschedule failed")
      return
    }
    toast.success(`Moved to ${next.toLocaleString()}`)
    router.refresh()
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const overId = String(over.id)
    const dayKey = overId.startsWith("day-") ? overId.slice(4) : overId.startsWith("hour-") ? overId.slice(5, 15) : null
    if (!dayKey) return

    const activeId = String(active.id)

    if (activeId.startsWith("chip-")) {
      await rescheduleExistingChip(activeId, dayKey)
      return
    }

    if (activeId.startsWith("unscheduled-")) {
      const payload = active.data.current as { postId: string; platform: SocialPlatform } | undefined
      if (!payload) return
      setPendingDrop({ postId: payload.postId, platform: payload.platform, dayKey })
    }
  }

  async function confirmPendingDrop(scheduledAtIso: string) {
    if (!pendingDrop) return
    const res = await fetch(`/api/admin/social/posts/${pendingDrop.postId}/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduled_at: scheduledAtIso }),
    })
    if (!res.ok) {
      toast.error(await res.text())
    } else {
      toast.success("Scheduled")
      router.refresh()
    }
    setPendingDrop(null)
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex h-[calc(100vh-220px)] min-h-[600px] gap-0 border border-border rounded-lg overflow-hidden bg-background">
        <LeftFilters videos={videos} />
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <h3 className="font-heading text-sm text-primary">
              {view === "month" &&
                anchor.toLocaleString(undefined, {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              {view === "week" && `Week of ${anchor.toLocaleDateString(undefined, { timeZone: "UTC" })}`}
              {view === "day" &&
                anchor.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                })}
            </h3>
            <CalendarViewToggle />
          </div>
          <div className="flex-1 overflow-auto p-2">
            {view === "month" && <MonthGrid anchor={anchor} chips={chipsFiltered} onEmptyDayClick={setManualPostDay} />}
            {view === "week" && <WeekGrid anchor={anchor} chips={chipsFiltered} onEmptyDayClick={setManualPostDay} />}
            {view === "day" && <DayGrid anchor={anchor} chips={chipsFiltered} onEmptyDayClick={setManualPostDay} />}
          </div>
        </div>
        <UnscheduledPanel posts={data.unscheduledPosts} />
      </div>

      {manualPostDay && (
        <ManualPostDialog
          dayKey={manualPostDay}
          onClose={() => setManualPostDay(null)}
          onCreated={() => {
            setManualPostDay(null)
            router.refresh()
          }}
        />
      )}
      {pendingDrop && (
        <TimePickerPopover
          platform={pendingDrop.platform}
          dayKey={pendingDrop.dayKey}
          onConfirm={confirmPendingDrop}
          onCancel={() => setPendingDrop(null)}
        />
      )}
    </DndContext>
  )
}
