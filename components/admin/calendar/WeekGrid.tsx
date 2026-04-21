"use client"

import { useState } from "react"
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import type { SocialPost } from "@/types/database"
import { PLATFORM_ICONS } from "@/lib/social/platform-ui"

interface WeekGridProps {
  posts: SocialPost[]
}

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day + 6) % 7
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - diff)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isoDateKey(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

interface DraggablePostChipProps {
  post: SocialPost
}

function DraggablePostChip({ post }: DraggablePostChipProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: post.id })
  const Icon = PLATFORM_ICONS[post.platform]
  const timeRef = post.scheduled_at ?? post.published_at
  const timeStr = timeRef ? new Date(timeRef).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : ""
  const isDraggableNow = post.approval_status === "scheduled"

  const dragProps = isDraggableNow ? { ref: setNodeRef, ...listeners, ...attributes } : {}

  return (
    <div
      {...dragProps}
      title={post.content.slice(0, 80)}
      className={`flex items-center gap-1 text-[11px] rounded px-1.5 py-1 truncate ${
        isDraggableNow
          ? "text-primary bg-primary/5 cursor-grab active:cursor-grabbing"
          : "text-muted-foreground bg-muted/30"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{timeStr}</span>
    </div>
  )
}

interface DroppableDayProps {
  date: Date
  posts: SocialPost[]
}

function DroppableDay({ date, posts }: DroppableDayProps) {
  const { setNodeRef, isOver } = useDroppable({ id: isoDateKey(date) })
  return (
    <div
      ref={setNodeRef}
      className={`border border-border rounded-lg p-2 min-h-[160px] transition ${
        isOver ? "bg-primary/5 border-primary" : ""
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {date.toLocaleDateString(undefined, { weekday: "short" })}
      </div>
      <div className="text-sm font-semibold text-primary mb-2">{date.getDate()}</div>
      <div className="space-y-1">
        {posts.map((post) => (
          <DraggablePostChip key={post.id} post={post} />
        ))}
      </div>
    </div>
  )
}

export function WeekGrid({ posts: initialPosts }: WeekGridProps) {
  const [posts, setPosts] = useState(initialPosts)
  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()))
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i))

  const postsByDay = days.map((d) =>
    posts.filter((p) => {
      const reference = p.scheduled_at ?? p.published_at
      if (!reference) return false
      return sameDay(new Date(reference), d)
    }),
  )

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const targetDateKey = over.id as string
    const post = posts.find((p) => p.id === active.id)
    if (!post || !post.scheduled_at) return

    const current = new Date(post.scheduled_at)
    const targetParts = targetDateKey.split("-").map(Number)
    const [ty, tm, td] = targetParts
    const next = new Date(current)
    next.setFullYear(ty, (tm ?? 1) - 1, td ?? 1)

    if (sameDay(current, next)) return

    if (next.getTime() <= Date.now()) {
      toast.error("Can't reschedule to a date in the past")
      return
    }

    const prevScheduledAt = post.scheduled_at
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, scheduled_at: next.toISOString() } : p)))

    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduled_at: next.toISOString() }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Reschedule failed")
      toast.success(`Moved to ${next.toLocaleString()}`)
    } catch (error) {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, scheduled_at: prevScheduledAt } : p)))
      toast.error((error as Error).message || "Reschedule failed")
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAnchor((prev) => addDays(prev, -7))}
            className="text-xs px-2 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10 inline-flex items-center gap-1"
          >
            <ChevronLeft className="size-3" /> Prev
          </button>
          <button
            type="button"
            onClick={() => setAnchor(startOfWeek(new Date()))}
            className="text-xs px-2 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10"
          >
            This week
          </button>
          <button
            type="button"
            onClick={() => setAnchor((prev) => addDays(prev, 7))}
            className="text-xs px-2 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10 inline-flex items-center gap-1"
          >
            Next <ChevronRight className="size-3" />
          </button>
        </div>
        <p className="text-sm font-medium text-primary">
          {days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} –{" "}
          {days[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </p>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Drag a scheduled post to a different day to reschedule. The time of day stays the same.
      </p>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-7 gap-2">
          {days.map((d, i) => (
            <DroppableDay key={i} date={d} posts={postsByDay[i]} />
          ))}
        </div>
      </DndContext>
    </div>
  )
}
