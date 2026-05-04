"use client"

import { useRef, useState } from "react"
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
import { useVisibleAnnotations } from "@/hooks/useVideoOverlay"
import type {
  TeamVideoSubmission,
  TeamVideoVersion,
  TeamVideoCommentWithAnnotation,
  DrawingJson,
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

  const { visible: visibleAnnotations, merged: mergedView } = useVisibleAnnotations(
    comments,
    currentTime,
  )

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

  function renderOverlay({ width, height }: { width: number; height: number }) {
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
            onChange={setDraftDrawing}
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
              onCreated={() => {}}
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
