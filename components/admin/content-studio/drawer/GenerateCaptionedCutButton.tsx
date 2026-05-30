"use client"

import { useState, useEffect } from "react"
import { Clapperboard } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { useAiJob } from "@/hooks/use-ai-job"

interface GenerateCaptionedCutButtonProps {
  videoUploadId: string
  hasTranscript: boolean
}

export function GenerateCaptionedCutButton({
  videoUploadId,
  hasTranscript,
}: GenerateCaptionedCutButtonProps) {
  const router = useRouter()
  const [jobId, setJobId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { status, result, error } = useAiJob(jobId)

  const running = submitting || status === "pending" || status === "processing"
  const disabled = running || !hasTranscript

  useEffect(() => {
    if (status === "completed" && result) {
      const postIds = (result.postIds as string[] | undefined) ?? []
      toast.success(
        postIds.length
          ? `Captioned cut ready — ${postIds.length} draft post${postIds.length > 1 ? "s" : ""} created`
          : "Captioned cut ready",
      )
      if (postIds[0]) router.push(`/admin/content/post/${postIds[0]}`)
      setJobId(null)
    } else if (status === "failed") {
      toast.error(error || "Captioned cut failed")
      setJobId(null)
    }
  }, [status, result, error, router])

  async function generate() {
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/content-studio/captioned-cut", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      const newJobId = data?.jobId
      if (typeof newJobId !== "string" || !newJobId) {
        throw new Error("Server returned no job id")
      }
      setJobId(newJobId)
      toast.message("Rendering captioned cut… this can take a couple of minutes.")
    } catch (err) {
      toast.error((err as Error).message || "Failed to start render")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={generate}
      disabled={disabled}
      title={
        !hasTranscript
          ? "No speech transcript — captions need spoken audio"
          : "Render a vertical 9:16 clip with word-pop captions burned in"
      }
      aria-label="Generate captioned cut"
      className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
    >
      <Clapperboard className="size-3.5" />
      {running ? "Rendering…" : "Generate Captioned Cut"}
    </button>
  )
}
