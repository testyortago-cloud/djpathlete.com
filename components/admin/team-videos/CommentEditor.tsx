"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Image as ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import type { DrawingJson, TeamVideoSubmissionKind } from "@/types/database"

interface Props {
  submissionId: string
  /** Returns the current player time (seconds) when called, or null for general comment. */
  getCurrentTimecode: () => number | null
  onCreated: () => void
  /** Optional drawing payload. When non-null, posted alongside the comment. */
  drawing?: DrawingJson | null
  /** Called after a successful POST so the parent can clear its drawing state. */
  onAfterSubmit?: () => void
  /**
   * For image_set submissions only — the index of the image currently being
   * reviewed. When the user toggles "Pin to current image", this becomes the
   * `annotation.index` on the outgoing payload.
   */
  currentImageIndex?: number | null
  /**
   * Submission kind. Defaults to undefined (treated as "video") so existing
   * callers keep working. When "image_set", the composer swaps the
   * "pin to current frame" affordance for "pin to current image".
   */
  submissionKind?: TeamVideoSubmissionKind
}

export function CommentEditor({
  submissionId,
  getCurrentTimecode,
  onCreated,
  drawing,
  onAfterSubmit,
  currentImageIndex,
  submissionKind,
}: Props) {
  const router = useRouter()
  const [text, setText] = useState("")
  const [general, setGeneral] = useState(false)
  const [pinToImage, setPinToImage] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const isImageSet = submissionKind === "image_set"

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        commentText: text.trim(),
      }
      if (isImageSet) {
        // Carousel submissions: pin-to-image OR general comment. Drawings
        // and timecodes don't apply here.
        body.timecodeSeconds = null
        if (pinToImage && typeof currentImageIndex === "number") {
          body.annotation = { kind: "image_index", index: currentImageIndex }
        }
      } else {
        const timecodeSeconds = general ? null : getCurrentTimecode()
        body.timecodeSeconds = timecodeSeconds
        if (drawing && drawing.paths.length > 0 && timecodeSeconds != null) {
          body.annotation = drawing
        }
      }
      const res = await fetch(
        `/api/admin/team-videos/${submissionId}/comments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? "Comment failed")
      }
      const result = await res.json().catch(() => ({}))
      if (result.annotationError) {
        toast.warning(`Comment posted, but drawing could not be saved: ${result.annotationError}`)
      }
      setText("")
      onCreated()
      onAfterSubmit?.()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Comment failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border bg-card p-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={
          isImageSet
            ? pinToImage
              ? `Comment on image ${(currentImageIndex ?? 0) + 1}…`
              : "General comment on this carousel…"
            : general
              ? "General comment..."
              : "Comment at current time..."
        }
      />
      <div className="flex items-center justify-between">
        {isImageSet ? (
          <Button
            type="button"
            size="sm"
            variant={pinToImage ? "default" : "outline"}
            onClick={() => setPinToImage((v) => !v)}
            disabled={typeof currentImageIndex !== "number"}
            aria-pressed={pinToImage}
          >
            <ImageIcon className="mr-1 size-4" />
            {pinToImage
              ? `Pinned to image ${(currentImageIndex ?? 0) + 1}`
              : "Pin to current image"}
          </Button>
        ) : (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={general}
              onChange={(e) => setGeneral(e.target.checked)}
            />
            General comment (not pinned to a frame)
          </label>
        )}
        <Button type="submit" size="sm" disabled={submitting || !text.trim()}>
          {submitting ? "Posting..." : isImageSet ? "Post comment" : "Add comment"}
        </Button>
      </div>
    </form>
  )
}
