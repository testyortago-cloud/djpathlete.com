"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import type { DrawingJson } from "@/types/database"

interface Props {
  submissionId: string
  /** Pixel size of the visible video frame (the renderOverlay container). */
  containerWidth: number
  containerHeight: number
  /** Normalized [0,1] anchor — usually the last-dropped pin / first vertex. */
  anchor: { x: number; y: number }
  /** Drawing payload to submit alongside the comment. */
  drawing: DrawingJson
  /** Returns the player's current timecode (seconds) — null if not playing yet. */
  getCurrentTimecode: () => number | null
  onSubmitted: () => void
  onCancel: () => void
}

const POPOVER_WIDTH = 280
// Popover height is approximate — used only to decide which side of the
// pin to render on. Off by a bit just shifts the placement; nothing breaks.
const POPOVER_HEIGHT = 160
const GAP = 14

export function PinCommentPopover({
  submissionId,
  containerWidth,
  containerHeight,
  anchor,
  drawing,
  getCurrentTimecode,
  onSubmitted,
  onCancel,
}: Props) {
  const router = useRouter()
  const [text, setText] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Anchor to the right+below the pin by default; flip across pin when near edges.
  const pinX = anchor.x * containerWidth
  const pinY = anchor.y * containerHeight
  const flipX = pinX + GAP + POPOVER_WIDTH > containerWidth
  const flipY = pinY + GAP + POPOVER_HEIGHT > containerHeight
  const left = clamp(
    flipX ? pinX - GAP - POPOVER_WIDTH : pinX + GAP,
    4,
    Math.max(4, containerWidth - POPOVER_WIDTH - 4),
  )
  const top = clamp(
    flipY ? pinY - GAP - POPOVER_HEIGHT : pinY + GAP,
    4,
    Math.max(4, containerHeight - POPOVER_HEIGHT - 4),
  )

  async function send() {
    if (!text.trim()) {
      toast.error("Add a comment first")
      return
    }
    const timecodeSeconds = getCurrentTimecode()
    if (timecodeSeconds == null) {
      toast.error("Cannot read player time — try again")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(
        `/api/admin/team-videos/${submissionId}/comments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            timecodeSeconds,
            commentText: text.trim(),
            annotation: drawing,
          }),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "Failed to post comment")
      if (json.annotationError) {
        toast.warning(
          `Comment posted, but drawing could not be saved: ${json.annotationError}`,
        )
      } else {
        toast.success("Comment posted")
      }
      setText("")
      onSubmitted()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post comment")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="pointer-events-auto absolute z-20 rounded-md border bg-card shadow-lg"
      style={{ width: POPOVER_WIDTH, left, top }}
      role="dialog"
      aria-label="Comment on pin"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
          Pin comment
        </span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          disabled={submitting}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary disabled:opacity-50"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="space-y-2 p-3">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="What should Darren see here?"
          disabled={submitting}
          className="w-full resize-none rounded-md border bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void send()
            }
            if (e.key === "Escape") onCancel()
          }}
        />
        <div className="flex items-center justify-between">
          <p className="font-mono text-[9px] tracking-widest uppercase text-muted-foreground">
            ⌘↵ to send · esc to cancel
          </p>
          <Button
            type="button"
            size="sm"
            onClick={send}
            disabled={submitting || !text.trim()}
          >
            <Send className="mr-1 size-3.5" />
            {submitting ? "Sending…" : "Post"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
