"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight, Facebook, Instagram, Music2, Youtube, Linkedin } from "lucide-react"
import type { SocialPost, SocialPlatform } from "@/types/database"

const PLATFORM_ICONS: Record<SocialPlatform, typeof Facebook> = {
  facebook: Facebook,
  instagram: Instagram,
  tiktok: Music2,
  youtube: Youtube,
  youtube_shorts: Youtube,
  linkedin: Linkedin,
}

interface WeekGridProps {
  posts: SocialPost[]
}

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day + 6) % 7 // Monday as start of week
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

export function WeekGrid({ posts }: WeekGridProps) {
  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()))
  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i))

  const postsByDay = days.map((d) =>
    posts.filter((p) => {
      const reference = p.scheduled_at ?? p.published_at
      if (!reference) return false
      return sameDay(new Date(reference), d)
    }),
  )

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

      <div className="grid grid-cols-7 gap-2">
        {days.map((d, i) => (
          <div key={i} className="border border-border rounded-lg p-2 min-h-[160px]">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {d.toLocaleDateString(undefined, { weekday: "short" })}
            </div>
            <div className="text-sm font-semibold text-primary mb-2">{d.getDate()}</div>
            <div className="space-y-1">
              {postsByDay[i].map((post) => {
                const Icon = PLATFORM_ICONS[post.platform]
                const timeRef = post.scheduled_at ?? post.published_at
                const timeStr = timeRef
                  ? new Date(timeRef).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
                  : ""
                return (
                  <div
                    key={post.id}
                    className="flex items-center gap-1 text-[11px] text-primary bg-primary/5 rounded px-1.5 py-1 truncate"
                    title={post.content.slice(0, 80)}
                  >
                    <Icon className="size-3 shrink-0" />
                    <span className="truncate">{timeStr}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
