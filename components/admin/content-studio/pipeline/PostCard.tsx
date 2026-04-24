"use client"

import Link from "next/link"
import { useDraggable } from "@dnd-kit/core"
import { Film, Clock, AlertCircle } from "lucide-react"
import type { PipelinePostRow } from "@/lib/db/social-posts"
import { PLATFORM_ICONS } from "@/lib/social/platform-ui"
import { accentStyle } from "@/lib/content-studio/video-accent"
import { cn } from "@/lib/utils"
import { PostTypeBadge } from "@/components/admin/content-studio/shared/PostTypeBadge"

interface PostCardProps {
  post: PipelinePostRow
  selected: boolean
  onToggleSelected: (postId: string, selected: boolean) => void
  /** Signed thumbnail URL of the source video, if available. */
  sourceThumbnailUrl?: string | null
}

export function PostCard({ post, selected, onToggleSelected, sourceThumbnailUrl }: PostCardProps) {
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

  const videoId = post.source_video_id

  return (
    <div
      ref={setNodeRef}
      {...(isDraggable ? { ...attributes, ...listeners } : {})}
      style={videoId ? accentStyle(videoId) : undefined}
      data-source-video-id={videoId ?? undefined}
      className={cn(
        "group relative overflow-hidden rounded-lg border border-border bg-white",
        "pl-[11px] pr-3 py-2.5 transition",
        "hover:border-primary/40 hover:shadow-[0_2px_8px_-3px_rgba(15,23,42,0.1)]",
        isDraggable && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
        isFailed && "border-error/40 bg-error/5",
        isPublished && "opacity-75",
      )}
    >
      {/* color-chip — matches the source video card on the left */}
      {videoId && (
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[3px] bg-[color:var(--video-accent)]"
        />
      )}
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelected(post.id, e.target.checked)}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Select post ${post.id}`}
          className="mt-1 size-3.5 rounded border-border text-primary focus:ring-primary/30"
        />
        <Link
          href={`/admin/content/post/${post.id}`}
          className="flex-1 min-w-0 space-y-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* platform badge + source thumbnail — the thumbnail is the "which video" cue */}
          <div className="flex items-center gap-2">
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/15">
              <Icon className="size-3.5 text-primary" />
            </span>
            <PostTypeBadge postType={post.post_type} />
            {sourceThumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sourceThumbnailUrl}
                alt=""
                className="size-6 rounded-md object-cover ring-1 ring-[color:var(--video-accent)]/40"
                loading="lazy"
              />
            ) : videoId ? (
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/40 ring-1 ring-border/60">
                <Film className="size-3 text-muted-foreground" />
              </span>
            ) : null}
            {post.source_video_filename && (
              <span
                className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground"
                title={post.source_video_filename}
              >
                {post.source_video_filename}
              </span>
            )}
          </div>
          <p
            className="text-[12.5px] leading-snug text-primary/90 line-clamp-3"
            title={post.content}
          >
            {post.content}
          </p>
        </Link>
      </div>
      {(scheduled || (isFailed && post.rejection_notes)) && (
        <div className="mt-2 space-y-1 border-t border-border/70 pt-2">
          {scheduled && (
            <p className="flex items-center gap-1 text-[10.5px] text-accent-foreground font-mono tabular-nums">
              <Clock className="size-3" /> {scheduled}
            </p>
          )}
          {isFailed && post.rejection_notes && (
            <p className="flex items-start gap-1 text-[10.5px] text-error">
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
              <span className="line-clamp-2">{post.rejection_notes}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
