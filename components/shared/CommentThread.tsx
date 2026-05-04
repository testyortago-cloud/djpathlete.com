"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CheckCircle2, RotateCw, MessageSquare, MapPin, Pencil, ArrowUpRight, Square } from "lucide-react"
import type { TeamVideoCommentWithAnnotation, DrawingPath } from "@/types/database"

function fmtTime(s: number | null): string {
  if (s == null) return "General"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, "0")
  return `${m}:${sec}`
}

/** Summarise a drawing as { totalCount, primaryToolIcon, primaryColor }. */
function summariseDrawing(paths: DrawingPath[]) {
  if (paths.length === 0) return null
  // Pick the most-frequent tool to set the icon; fall back to first path's color.
  const counts: Record<string, number> = {}
  for (const p of paths) counts[p.tool] = (counts[p.tool] ?? 0) + 1
  const primaryTool = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as DrawingPath["tool"]
  return {
    count: paths.length,
    tool: primaryTool,
    color: paths[0].color,
  }
}

const TOOL_ICON = {
  pin: MapPin,
  pen: Pencil,
  arrow: ArrowUpRight,
  rectangle: Square,
} as const

interface Props {
  comments: TeamVideoCommentWithAnnotation[]
  /** When true, show resolve/reopen actions. */
  canWrite: boolean
  onResolve?: (commentId: string) => void
  onReopen?: (commentId: string) => void
  onJumpTo?: (timecodeSeconds: number) => void
}

export function CommentThread({
  comments,
  canWrite,
  onResolve,
  onReopen,
  onJumpTo,
}: Props) {
  const [showResolved, setShowResolved] = useState(false)
  const open = comments.filter((c) => c.status === "open")
  const resolved = comments.filter((c) => c.status === "resolved")

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <MessageSquare className="size-4 text-muted-foreground" />
        <span className="font-medium">{open.length} open</span>
        {resolved.length > 0 && (
          <span className="text-muted-foreground">· {resolved.length} resolved</span>
        )}
      </div>

      {open.length === 0 && resolved.length === 0 && (
        <p className="rounded-md border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          No comments yet.
        </p>
      )}

      <ul className="space-y-2">
        {open.map((c) => {
          const annotation = c.annotation
            ? summariseDrawing(c.annotation.paths)
            : null
          const ToolIcon = annotation ? TOOL_ICON[annotation.tool] : null
          const hasTime = c.timecode_seconds != null
          return (
            <li
              key={c.id}
              className={`group rounded-md border bg-card p-3 transition-colors ${
                hasTime ? "cursor-pointer hover:bg-muted/40" : ""
              }`}
              onClick={() => {
                if (hasTime) onJumpTo?.(c.timecode_seconds!)
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-xs font-medium ${
                        hasTime ? "text-primary group-hover:underline" : "text-muted-foreground"
                      }`}
                    >
                      {fmtTime(c.timecode_seconds)}
                    </span>
                    {annotation && ToolIcon && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                        title={`${annotation.count} ${annotation.tool}${annotation.count === 1 ? "" : "s"} on the frame — click to jump`}
                      >
                        <ToolIcon
                          className="size-3"
                          style={{ color: annotation.color }}
                        />
                        <span>{annotation.count}</span>
                      </span>
                    )}
                  </div>
                  <p className="text-sm">{c.comment_text}</p>
                </div>
                {canWrite && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      onResolve?.(c.id)
                    }}
                    aria-label="Resolve comment"
                  >
                    <CheckCircle2 className="size-4" />
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {resolved.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowResolved((s) => !s)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showResolved ? "Hide" : "Show"} {resolved.length} resolved
          </button>
          {showResolved && (
            <ul className="space-y-2">
              {resolved.map((c) => (
                <li key={c.id} className="rounded-md border bg-muted/40 p-3 opacity-70">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <span className="font-mono text-xs text-muted-foreground line-through">
                        {fmtTime(c.timecode_seconds)}
                      </span>
                      <p className="text-sm line-through">{c.comment_text}</p>
                    </div>
                    {canWrite && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onReopen?.(c.id)}
                        aria-label="Reopen comment"
                      >
                        <RotateCw className="size-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
