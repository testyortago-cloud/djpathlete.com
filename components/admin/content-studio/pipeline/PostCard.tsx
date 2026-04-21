"use client"

import Link from "next/link"
import { useDraggable } from "@dnd-kit/core"
import { Film, Clock, AlertCircle } from "lucide-react"
import type { PipelinePostRow } from "@/lib/db/social-posts"
import { PLATFORM_ICONS } from "@/lib/social/platform-ui"
import { cn } from "@/lib/utils"

interface PostCardProps {
  post: PipelinePostRow
  selected: boolean
  onToggleSelected: (postId: string, selected: boolean) => void
}

export function PostCard({ post, selected, onToggleSelected }: PostCardProps) {
  const isPublished = post.approval_status === "published"
  const isFailed = post.approval_status === "failed"
  const isDraggable = !isPublished

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: post.id,
    disabled: !isDraggable,
  })
  const Icon = PLATFORM_ICONS[post.platform]

  const scheduled = post.scheduled_at
    ? new Date(post.scheduled_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null

  return (
    <div
      ref={setNodeRef}
      {...(isDraggable ? { ...attributes, ...listeners } : {})}
      className={cn(
        "group relative rounded-lg border border-border bg-white p-3 transition",
        isDraggable && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
        isFailed && "border-error/40 bg-error/5",
        isPublished && "opacity-75",
      )}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelected(post.id, e.target.checked)}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Select post ${post.id}`}
          className="mt-0.5 size-4 rounded border-border text-primary focus:ring-primary/30"
        />
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="size-4 text-primary" />
        </div>
        <Link
          href={`/admin/content/post/${post.id}`}
          className="flex-1 min-w-0"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-primary line-clamp-2" title={post.content}>
            {post.content}
          </p>
        </Link>
      </div>
      {post.source_video_filename && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground truncate">
          <Film className="size-3 shrink-0" /> {post.source_video_filename}
        </p>
      )}
      {scheduled && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-accent">
          <Clock className="size-3" /> {scheduled}
        </p>
      )}
      {isFailed && post.rejection_notes && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-error">
          <AlertCircle className="size-3 shrink-0 mt-0.5" />
          <span className="line-clamp-2">{post.rejection_notes}</span>
        </p>
      )}
    </div>
  )
}
