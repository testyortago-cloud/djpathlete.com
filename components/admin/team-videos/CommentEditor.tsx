"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import type { DrawingJson } from "@/types/database"

interface Props {
  submissionId: string
  /** Returns the current player time (seconds) when called, or null for general comment. */
  getCurrentTimecode: () => number | null
  onCreated: () => void
  /** Optional drawing payload. When non-null, posted alongside the comment. */
  drawing?: DrawingJson | null
  /** Called after a successful POST so the parent can clear its drawing state. */
  onAfterSubmit?: () => void
}

export function CommentEditor({
  submissionId,
  getCurrentTimecode,
  onCreated,
  drawing,
  onAfterSubmit,
}: Props) {
  const router = useRouter()
  const [text, setText] = useState("")
  const [general, setGeneral] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setSubmitting(true)
    try {
      const timecodeSeconds = general ? null : getCurrentTimecode()
      const body: Record<string, unknown> = {
        timecodeSeconds,
        commentText: text.trim(),
      }
      if (drawing && drawing.paths.length > 0 && timecodeSeconds != null) {
        body.annotation = drawing
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
          general ? "General comment..." : "Comment at current time..."
        }
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={general}
            onChange={(e) => setGeneral(e.target.checked)}
          />
          General comment (not pinned to a frame)
        </label>
        <Button type="submit" size="sm" disabled={submitting || !text.trim()}>
          {submitting ? "Posting..." : "Add comment"}
        </Button>
      </div>
    </form>
  )
}
