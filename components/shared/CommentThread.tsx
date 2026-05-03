"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CheckCircle2, RotateCw, MessageSquare } from "lucide-react"
import type { TeamVideoComment } from "@/types/database"

function fmtTime(s: number | null): string {
  if (s == null) return "General"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, "0")
  return `${m}:${sec}`
}

interface Props {
  comments: TeamVideoComment[]
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
        {open.map((c) => (
          <li key={c.id} className="rounded-md border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => onJumpTo?.(c.timecode_seconds ?? 0)}
                  disabled={c.timecode_seconds == null}
                  className="font-mono text-xs font-medium text-primary hover:underline disabled:no-underline disabled:text-muted-foreground"
                >
                  {fmtTime(c.timecode_seconds)}
                </button>
                <p className="text-sm">{c.comment_text}</p>
              </div>
              {canWrite && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onResolve?.(c.id)}
                  aria-label="Resolve comment"
                >
                  <CheckCircle2 className="size-4" />
                </Button>
              )}
            </div>
          </li>
        ))}
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
