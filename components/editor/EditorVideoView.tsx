"use client"

import { useRef, useState } from "react"
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
import { uploadToSignedUrl } from "@/lib/firebase-client-upload"
import type {
  TeamVideoSubmission,
  TeamVideoVersion,
  TeamVideoComment,
} from "@/types/database"

interface Props {
  submission: TeamVideoSubmission
  version: TeamVideoVersion | null
  comments: TeamVideoComment[]
  videoUrl: string | null
}

export function EditorVideoView({ submission, version, comments, videoUrl }: Props) {
  const router = useRouter()
  const playerRef = useRef<TeamVideoPlayerHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const canRevise = submission.status === "revision_requested"

  async function handleRevisionUpload(file: File) {
    setUploading(true)
    try {
      const verRes = await fetch(`/api/editor/submissions/${submission.id}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      })
      if (!verRes.ok) {
        const json = await verRes.json().catch(() => ({}))
        throw new Error(json.error ?? "Failed to create version")
      }
      const { upload } = await verRes.json()

      // Upload to Firebase Storage via the v4 signed URL.
      await uploadToSignedUrl(upload.uploadUrl, file)

      const finRes = await fetch(`/api/editor/submissions/${submission.id}/finalize`, {
        method: "POST",
      })
      if (!finRes.ok) {
        const json = await finRes.json().catch(() => ({}))
        throw new Error(json.error ?? "Finalize failed")
      }
      toast.success("New version submitted")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/editor">
            <ArrowLeft className="mr-1 size-4" /> Back
          </Link>
        </Button>
      </div>

      <header>
        <h2 className="font-heading text-2xl text-primary">{submission.title}</h2>
        {submission.description && (
          <p className="font-body text-sm text-muted-foreground">{submission.description}</p>
        )}
        {version && (
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Version {version.version_number} &middot; status: {submission.status}
          </p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          {videoUrl ? (
            <TeamVideoPlayer
              ref={playerRef}
              src={videoUrl}
              comments={comments}
              onMarkerClick={() => {
                /* parent could scroll thread; v1 just seeks */
              }}
            />
          ) : (
            <div className="rounded-md border border-dashed bg-muted/40 p-12 text-center text-sm text-muted-foreground">
              No video uploaded yet.
            </div>
          )}

          {canRevise && (
            <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-4">
              <p className="text-sm font-medium text-warning">Darren requested a revision.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Upload a new version to address the open comments.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleRevisionUpload(f)
                }}
              />
              <Button
                type="button"
                size="sm"
                className="mt-3"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? "Uploading..." : "Upload new version"}
              </Button>
            </div>
          )}
        </div>

        <aside>
          <CommentThread
            comments={comments}
            canWrite={false}
            onJumpTo={(t) => playerRef.current?.seek(t)}
          />
        </aside>
      </div>
    </div>
  )
}
