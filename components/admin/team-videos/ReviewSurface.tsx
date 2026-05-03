"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Brush } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import {
  TeamVideoPlayer,
  type TeamVideoPlayerHandle,
} from "@/components/shared/TeamVideoPlayer"
import { CommentThread } from "@/components/shared/CommentThread"
import { DrawingCanvas } from "@/components/shared/DrawingCanvas"
import { StatusActions } from "./StatusActions"
import { CommentEditor } from "./CommentEditor"
import { DrawingToolbar } from "./DrawingToolbar"
import type {
  TeamVideoSubmission,
  TeamVideoVersion,
  TeamVideoCommentWithAnnotation,
  DrawingJson,
  DrawingTool,
} from "@/types/database"

const VISIBILITY_WINDOW_S = 0.5

interface Props {
  submission: TeamVideoSubmission
  version: TeamVideoVersion | null
  comments: TeamVideoCommentWithAnnotation[]
  videoUrl: string | null
}

export function ReviewSurface({ submission, version, comments, videoUrl }: Props) {
  const router = useRouter()
  const playerRef = useRef<TeamVideoPlayerHandle>(null)
  // overlayRef points only to the outer relative wrapper — single placement per recommendation
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 })
  const [currentTime, setCurrentTime] = useState(0)

  // Drawing-mode state
  const [drawingMode, setDrawingMode] = useState(false)
  const [tool, setTool] = useState<DrawingTool>("arrow")
  const [color, setColor] = useState("#FF3B30")
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [draftDrawing, setDraftDrawing] = useState<DrawingJson>({ paths: [] })

  // Track the rendered video size so the canvas matches it pixel-for-pixel
  useEffect(() => {
    if (!overlayRef.current) return
    const el = overlayRef.current
    const ro = new ResizeObserver(() => {
      setOverlaySize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [videoUrl])

  // Visible annotations: open + timecoded + within window
  const visibleAnnotations = comments.filter(
    (c) =>
      c.status === "open" &&
      c.timecode_seconds != null &&
      c.annotation != null &&
      Math.abs(currentTime - c.timecode_seconds!) <= VISIBILITY_WINDOW_S,
  )
  const mergedView: DrawingJson = {
    paths: visibleAnnotations.flatMap((c) => c.annotation?.paths ?? []),
  }

  function startDrawing() {
    playerRef.current?.pause()
    setDraftDrawing({ paths: [] })
    setDrawingMode(true)
  }

  function cancelDrawing() {
    setDraftDrawing({ paths: [] })
    setDrawingMode(false)
  }

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

  function renderOverlay() {
    if (overlaySize.width === 0 || overlaySize.height === 0) return null
    // No ref here — overlayRef stays on the outer wrapper only
    return (
      <div className="absolute inset-0">
        {/* Read-only annotations from existing visible comments */}
        {!drawingMode && visibleAnnotations.length > 0 && (
          <DrawingCanvas
            mode="view"
            width={overlaySize.width}
            height={overlaySize.height}
            drawing={mergedView}
          />
        )}
        {/* Active drawing canvas in edit mode */}
        {drawingMode && (
          <DrawingCanvas
            mode="edit"
            width={overlaySize.width}
            height={overlaySize.height}
            tool={tool}
            color={color}
            strokeWidth={strokeWidth}
            drawing={draftDrawing}
            onChange={setDraftDrawing}
          />
        )}
      </div>
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
            <div ref={overlayRef} className="relative">
              <TeamVideoPlayer
                ref={playerRef}
                src={videoUrl}
                comments={comments}
                onTimeUpdate={setCurrentTime}
                renderOverlay={renderOverlay}
              />
            </div>
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
              onToolChange={setTool}
              onColorChange={setColor}
              onStrokeWidthChange={setStrokeWidth}
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
                <p className="text-xs text-muted-foreground">
                  Draw on the video, then add a comment to save the drawing with it.
                </p>
              )}
            </div>
          )}

          {videoUrl && (
            <CommentEditor
              submissionId={submission.id}
              getCurrentTimecode={() =>
                playerRef.current?.getCurrentTime() ?? null
              }
              onCreated={() => router.refresh()}
              drawing={drawingMode ? draftDrawing : null}
              onAfterSubmit={cancelDrawing}
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
