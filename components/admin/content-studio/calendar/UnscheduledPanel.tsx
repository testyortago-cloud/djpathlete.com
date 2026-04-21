"use client"

import { useState } from "react"
import { useDraggable } from "@dnd-kit/core"
import { ChevronDown, ChevronRight, Film, Sparkles } from "lucide-react"
import type { PipelinePostRow } from "@/lib/db/social-posts"
import { cn } from "@/lib/utils"

function DraggableCard({ post }: { post: PipelinePostRow }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `unscheduled-${post.id}`,
    data: { postId: post.id, platform: post.platform },
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "p-2 rounded border border-border bg-white text-xs cursor-grab active:cursor-grabbing hover:border-primary/50",
        isDragging && "opacity-40",
      )}
    >
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{post.platform}</p>
      <p className="text-primary line-clamp-3 mt-0.5">{post.content}</p>
    </div>
  )
}

function Group({ title, posts, icon }: { title: string; posts: PipelinePostRow[]; icon: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 text-left text-xs font-semibold text-primary mb-1"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {icon}
        <span className="truncate">{title}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">({posts.length})</span>
      </button>
      {open && (
        <div className="space-y-1 pl-3">
          {posts.map((p) => (
            <DraggableCard key={p.id} post={p} />
          ))}
        </div>
      )}
    </section>
  )
}

interface UnscheduledPanelProps {
  posts: PipelinePostRow[]
}

export function UnscheduledPanel({ posts }: UnscheduledPanelProps) {
  if (posts.length === 0) {
    return (
      <aside
        aria-label="Unscheduled posts"
        className="w-72 shrink-0 px-3 py-6 text-center border-l border-border bg-surface/30"
      >
        <Sparkles className="size-6 text-muted-foreground mx-auto mb-2" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">All caught up.</p>
        <p className="text-xs text-muted-foreground/70 mt-1">Nothing is waiting to be scheduled.</p>
      </aside>
    )
  }

  const groups = new Map<string, { title: string; posts: PipelinePostRow[] }>()
  for (const p of posts) {
    const key = p.source_video_id ?? "__manual__"
    const title = p.source_video_filename ?? (key === "__manual__" ? "Manual posts" : "Unknown source")
    const g = groups.get(key) ?? { title, posts: [] }
    g.posts.push(p)
    groups.set(key, g)
  }

  return (
    <aside
      aria-label="Unscheduled posts"
      className="w-72 shrink-0 border-l border-border bg-surface/30 overflow-y-auto"
    >
      <header className="px-3 py-2 border-b border-border">
        <h3 className="font-heading text-xs uppercase tracking-wide text-primary">Unscheduled</h3>
        <p className="text-[11px] text-muted-foreground">Drag any post onto a day to schedule</p>
      </header>
      <div className="p-3">
        {Array.from(groups.entries()).map(([key, g]) => (
          <Group key={key} title={g.title} icon={<Film className="size-3 shrink-0" />} posts={g.posts} />
        ))}
      </div>
    </aside>
  )
}
