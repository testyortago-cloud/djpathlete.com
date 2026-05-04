"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { ArrowLeft, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
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
import { useVisibleAnnotations } from "@/hooks/useVideoOverlay"
import { RevisionUploadZone } from "@/components/editor/RevisionUploadZone"
import {
  VersionHistoryList,
  type VersionRow,
} from "@/components/editor/VersionHistoryList"
import type {
  TeamVideoSubmission,
  TeamVideoVersion,
  TeamVideoCommentWithAnnotation,
} from "@/types/database"

interface Props {
  submission: TeamVideoSubmission
  /** Current (latest) version on the submission. */
  version: TeamVideoVersion | null
  comments: TeamVideoCommentWithAnnotation[]
  /** Signed read URL for the *current* version, or null. */
  videoUrl: string | null
  /** All versions on the submission, with pre-fetched signed URLs. */
  versions: VersionRow[]
}

export function EditorVideoView({
  submission,
  version,
  comments,
  videoUrl,
  versions,
}: Props) {
  const router = useRouter()
  const playerRef = useRef<TeamVideoPlayerHandle>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [newCommentText, setNewCommentText] = useState("")
  const [postingTopLevel, setPostingTopLevel] = useState(false)

  // Which version is the player currently showing? Defaults to current.
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    version?.id ?? null,
  )

  // Resolve the playable URL from the selected version's signed URL,
  // falling back to the prop-supplied current-version URL for the default state.
  const selectedSignedUrl = useMemo(() => {
    if (!selectedVersionId) return videoUrl
    const v = versions.find((x) => x.id === selectedVersionId)
    return v?.signedUrl ?? videoUrl
  }, [selectedVersionId, versions, videoUrl])

  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) ?? version,
    [selectedVersionId, versions, version],
  )

  // Comments are only meaningful for the LATEST version. When viewing an
  // older version, suppress the overlay/thread to avoid implying these
  // comments belong to that older cut.
  const viewingCurrent = selectedVersionId === version?.id
  const visibleComments = viewingCurrent ? comments : []

  const { visible: visibleAnnotations, merged: mergedView } = useVisibleAnnotations(
    visibleComments,
    currentTime,
  )

  function renderOverlay({ width, height }: { width: number; height: number }) {
    if (visibleAnnotations.length === 0) return null
    return (
      <DrawingCanvas
        mode="view"
        width={width}
        height={height}
        drawing={mergedView}
      />
    )
  }

  const canRevise = submission.status === "revision_requested"

  async function postEditorComment(input: {
    parentId?: string
    commentText: string
    timecodeSeconds?: number | null
  }) {
    const res = await fetch(
      `/api/editor/submissions/${submission.id}/comments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          timecodeSeconds: input.timecodeSeconds ?? null,
          commentText: input.commentText,
          parentId: input.parentId ?? null,
        }),
      },
    )
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error ?? "Failed to post comment")
    }
    router.refresh()
  }

  async function submitTopLevel() {
    if (!newCommentText.trim() || !viewingCurrent) return
    setPostingTopLevel(true)
    try {
      const t = playerRef.current?.getCurrentTime() ?? null
      await postEditorComment({
        commentText: newCommentText.trim(),
        timecodeSeconds: t != null ? Math.max(0, t) : null,
      })
      setNewCommentText("")
      toast.success("Comment posted")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post comment")
    } finally {
      setPostingTopLevel(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/editor/submissions">
            <ArrowLeft className="mr-1 size-4" /> Back
          </Link>
        </Button>
      </div>

      <header className="space-y-1">
        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          Submission
        </p>
        <h2 className="font-heading text-2xl text-primary">{submission.title}</h2>
        {submission.description && (
          <p className="font-body text-sm text-muted-foreground">
            {submission.description}
          </p>
        )}
        {selectedVersion && (
          <p className="font-mono text-xs text-muted-foreground">
            Version {selectedVersion.version_number} &middot; status:{" "}
            {submission.status}
            {!viewingCurrent && (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Older cut · history view
              </span>
            )}
          </p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {selectedSignedUrl ? (
            <TeamVideoPlayer
              ref={playerRef}
              src={selectedSignedUrl}
              comments={visibleComments}
              onMarkerClick={() => {
                /* parent could scroll thread; v1 just seeks */
              }}
              onTimeUpdate={setCurrentTime}
              renderOverlay={renderOverlay}
            />
          ) : (
            <div className="rounded-md border border-dashed bg-muted/40 p-12 text-center text-sm text-muted-foreground">
              No video uploaded yet.
            </div>
          )}

          {canRevise && viewingCurrent && (
            <RevisionUploadZone submissionId={submission.id} />
          )}

          <VersionHistoryList
            versions={versions}
            selectedId={selectedVersionId}
            onSelect={(id) => {
              setSelectedVersionId(id)
              setCurrentTime(0)
            }}
          />
        </div>

        <aside className="space-y-3">
          <CommentThread
            comments={visibleComments}
            canWrite={false}
            onJumpTo={(t) => playerRef.current?.seek(t)}
            onReply={
              viewingCurrent
                ? async ({ parentId, commentText }) => {
                    await postEditorComment({ parentId, commentText })
                    toast.success("Reply posted")
                  }
                : undefined
            }
          />
          {!viewingCurrent && (
            <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
              Comments shown only on the current cut.
            </p>
          )}
          {viewingCurrent && (
            <div className="rounded-md border bg-card p-3 space-y-2">
              <Textarea
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                rows={2}
                placeholder="Reply to Darren or add a note…"
                disabled={postingTopLevel}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void submitTopLevel()
                  }
                }}
                className="text-sm"
              />
              <div className="flex items-center justify-between">
                <p className="font-mono text-[9px] tracking-widest uppercase text-muted-foreground">
                  Posts at current player time
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={submitTopLevel}
                  disabled={postingTopLevel || !newCommentText.trim()}
                >
                  <Send className="mr-1 size-3.5" />
                  {postingTopLevel ? "Posting…" : "Comment"}
                </Button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
