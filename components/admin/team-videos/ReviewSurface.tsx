"use client"

import { useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import {
  TeamVideoPlayer,
  type TeamVideoPlayerHandle,
} from "@/components/shared/TeamVideoPlayer"
import { CommentThread } from "@/components/shared/CommentThread"
import { StatusActions } from "./StatusActions"
import { CommentEditor } from "./CommentEditor"
import type {
  TeamVideoSubmission,
  TeamVideoVersion,
  TeamVideoCommentWithAnnotation,
} from "@/types/database"

interface Props {
  submission: TeamVideoSubmission
  version: TeamVideoVersion | null
  comments: TeamVideoCommentWithAnnotation[]
  videoUrl: string | null
}

export function ReviewSurface({
  submission,
  version,
  comments,
  videoUrl,
}: Props) {
  const router = useRouter()
  const playerRef = useRef<TeamVideoPlayerHandle>(null)

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

  return (
    <div className="space-y-4 p-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/admin/team-videos">
          <ArrowLeft className="mr-1 size-4" /> Back
        </Link>
      </Button>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-primary">
            {submission.title}
          </h1>
          {submission.description && (
            <p className="font-body text-sm text-muted-foreground">
              {submission.description}
            </p>
          )}
          {version && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Version {version.version_number} &middot; status:{" "}
              {submission.status}
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
            />
          ) : (
            <div className="rounded-md border border-dashed bg-muted/40 p-12 text-center text-sm text-muted-foreground">
              {version ? "Video upload not finalized." : "No video uploaded yet."}
            </div>
          )}
          {videoUrl && (
            <CommentEditor
              submissionId={submission.id}
              getCurrentTimecode={() =>
                playerRef.current?.getCurrentTime() ?? null
              }
              onCreated={() => router.refresh()}
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
