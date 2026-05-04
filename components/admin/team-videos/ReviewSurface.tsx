"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { ArrowLeft, Brush } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import {
  TeamVideoPlayer,
  type TeamVideoPlayerHandle,
} from "@/components/shared/TeamVideoPlayer"
import { CommentThread } from "@/components/shared/CommentThread"
// react-konva is canvas-only — load DrawingCanvas client-side only.
const DrawingCanvas = dynamic(
  () => import("@/components/shared/DrawingCanvas").then((m) => m.DrawingCanvas),
  { ssr: false },
)
import { StatusActions } from "./StatusActions"
import { CommentEditor } from "./CommentEditor"
import { DrawingToolbar } from "./DrawingToolbar"
import { PinCommentPopover } from "./PinCommentPopover"
import { useVisibleAnnotations } from "@/hooks/useVideoOverlay"
import type {
  TeamVideoSubmission,
  TeamVideoVersion,
  TeamVideoCommentWithAnnotation,
  DrawingJson,
  DrawingPath,
  DrawingTool,
} from "@/types/database"

interface Props {
  submission: TeamVideoSubmission
  version: TeamVideoVersion | null
  comments: TeamVideoCommentWithAnnotation[]
  videoUrl: string | null
}

export function ReviewSurface({ submission, version, comments, videoUrl }: Props) {
  const router = useRouter()
  const playerRef = useRef<TeamVideoPlayerHandle>(null)
  const [currentTime, setCurrentTime] = useState(0)

  // Drawing-mode state
  const [drawingMode, setDrawingMode] = useState(false)
  const [tool, setTool] = useState<DrawingTool>("pin")
  const [color, setColor] = useState("#FF3B30")
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [draftDrawing, setDraftDrawing] = useState<DrawingJson>({ paths: [] })
  // Stack of paths the user has undone — top of stack = most recent undo.
  const [redoStack, setRedoStack] = useState<DrawingPath[]>([])

  const { visible: visibleAnnotations, merged: mergedView } = useVisibleAnnotations(
    comments,
    currentTime,
  )

  function startDrawing() {
    playerRef.current?.pause()
    setDraftDrawing({ paths: [] })
    setRedoStack([])
    setDrawingMode(true)
  }

  function cancelDrawing() {
    setDraftDrawing({ paths: [] })
    setRedoStack([])
    setDrawingMode(false)
  }

  /**
   * Wrap canvas onChange so any newly-added path invalidates the redo stack
   * (forking the timeline). Pure replacement (same length or shorter) leaves
   * redo intact — but the canvas only ever appends, so this branch never runs.
   */
  function handleDraftChange(next: DrawingJson) {
    setDraftDrawing(next)
    setRedoStack([])
  }

  function undoLast() {
    if (draftDrawing.paths.length === 0) return
    const last = draftDrawing.paths[draftDrawing.paths.length - 1]
    setDraftDrawing({ paths: draftDrawing.paths.slice(0, -1) })
    setRedoStack((s) => [...s, last])
  }

  function redoLast() {
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    setRedoStack((s) => s.slice(0, -1))
    setDraftDrawing((d) => ({ paths: [...d.paths, next] }))
  }

  function clearAll() {
    if (draftDrawing.paths.length === 0) return
    setDraftDrawing({ paths: [] })
    setRedoStack([])
  }

  // ⌘Z / ⌘⇧Z shortcuts — only active while drawing, only when not typing
  useEffect(() => {
    if (!drawingMode) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      // Skip if focus is in any text input — let the browser handle native undo
      if (
        target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable)
      ) {
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) redoLast()
        else undoLast()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingMode, draftDrawing, redoStack])

  async function resolveComment(commentId: string) {
    const res = await fetch(
      `/api/admin/team-videos/${submission.id}/comments/${commentId}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resolve" }),
      },
    )
    if (res.ok) {
      toast.success("Resolved")
      router.refresh()
    } else {
      toast.error("Failed to resolve")
    }
  }

  async function reopenComment(commentId: string) {
    const res = await fetch(
      `/api/admin/team-videos/${submission.id}/comments/${commentId}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reopen" }),
      },
    )
    if (res.ok) {
      toast.success("Reopened")
      router.refresh()
    } else {
      toast.error("Failed to reopen")
    }
  }

  function renderOverlay({ width, height }: { width: number; height: number }) {
    // Anchor for the floating Loom-style popover: the first vertex of the
    // last path the user drew. For pins that's the pin itself; for arrows
    // / rectangles it's the start point; for pen strokes it's the start.
    const lastPath = draftDrawing.paths[draftDrawing.paths.length - 1]
    const anchor = lastPath
      ? { x: lastPath.points[0][0], y: lastPath.points[0][1] }
      : null

    return (
      <>
        {/* Read-only annotations from existing visible comments */}
        {!drawingMode && visibleAnnotations.length > 0 && (
          <DrawingCanvas
            mode="view"
            width={width}
            height={height}
            drawing={mergedView}
          />
        )}
        {/* Active drawing canvas in edit mode */}
        {drawingMode && (
          <DrawingCanvas
            mode="edit"
            width={width}
            height={height}
            tool={tool}
            color={color}
            strokeWidth={strokeWidth}
            drawing={draftDrawing}
            onChange={handleDraftChange}
          />
        )}
        {/* Inline Loom-style comment composer, anchored to the last mark */}
        {drawingMode && anchor && (
          <PinCommentPopover
            submissionId={submission.id}
            containerWidth={width}
            containerHeight={height}
            anchor={anchor}
            drawing={draftDrawing}
            getCurrentTimecode={() =>
              playerRef.current?.getCurrentTime() ?? null
            }
            onSubmitted={cancelDrawing}
            onCancel={cancelDrawing}
          />
        )}
      </>
    )
  }

  return (
    <div className="space-y-4 p-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/admin/team-videos">
          <ArrowLeft className="mr-1 size-4" /> Back
        </Link>
      </Button>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-primary">{submission.title}</h1>
          {submission.description && (
            <p className="font-body text-sm text-muted-foreground">
              {submission.description}
            </p>
          )}
          {version && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Version {version.version_number} &middot; status: {submission.status}
            </p>
          )}
        </div>
        <StatusActions submission={submission} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {videoUrl ? (
            <TeamVideoPlayer
              ref={playerRef}
              src={videoUrl}
              comments={comments}
              onTimeUpdate={setCurrentTime}
              renderOverlay={renderOverlay}
            />
          ) : (
            <div className="rounded-md border border-dashed bg-muted/40 p-12 text-center text-sm text-muted-foreground">
              {version ? "Video upload not finalized." : "No video uploaded yet."}
            </div>
          )}

          {videoUrl && (
            <DrawingToolbar
              active={drawingMode}
              tool={tool}
              color={color}
              strokeWidth={strokeWidth}
              canUndo={draftDrawing.paths.length > 0}
              canRedo={redoStack.length > 0}
              onToolChange={setTool}
              onColorChange={setColor}
              onStrokeWidthChange={setStrokeWidth}
              onUndo={undoLast}
              onRedo={redoLast}
              onClear={clearAll}
              onCancel={cancelDrawing}
            />
          )}

          {videoUrl && (
            <div className="flex items-center gap-2">
              {!drawingMode ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={startDrawing}
                >
                  <Brush className="mr-1 size-4" /> Draw on frame
                </Button>
              ) : (
                <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
                  {draftDrawing.paths.length === 0
                    ? "Drop a pin or draw on the frame to add a comment."
                    : "Type your comment in the popover next to your mark."}
                </p>
              )}
            </div>
          )}

          {/* While drawing, the inline popover IS the composer; hide the */}
          {/* bottom editor to avoid two competing inputs. */}
          {videoUrl && !drawingMode && (
            <CommentEditor
              submissionId={submission.id}
              getCurrentTimecode={() =>
                playerRef.current?.getCurrentTime() ?? null
              }
              onCreated={() => {}}
              drawing={null}
              onAfterSubmit={() => {}}
            />
          )}
        </div>

        <aside>
          <CommentThread
            comments={comments}
            canWrite={true}
            onResolve={resolveComment}
            onReopen={reopenComment}
            onJumpTo={(t) => playerRef.current?.seek(t)}
          />
        </aside>
      </div>
    </div>
  )
}
