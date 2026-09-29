"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Linkedin, Loader2, ArrowRight } from "lucide-react"
import { toast } from "sonner"
import { useAiJob } from "@/hooks/use-ai-job"
import { cn } from "@/lib/utils"

type Source = { blogPostId: string } | { newsletterId: string }
type State = "idle" | "requesting" | "writing" | "ready" | "exists"

// Where the draft is reviewed. POST /api/admin/social/share answers it, because
// the Content Studio flag that decides it is server-only.
type Review = { label: string; listHref: string; postHrefPrefix: string | null }

// Only used if a response ever lacks `review`: the page that exists whichever way the flag is set.
const FALLBACK_REVIEW: Review = { label: "Social", listHref: "/admin/social", postHrefPrefix: null }

function draftIdFromJob(result: Record<string, unknown> | null): string | null {
  const platforms = result?.platforms
  if (!Array.isArray(platforms)) return null
  const id = (platforms[0] as { social_post_id?: unknown } | undefined)?.social_post_id
  return typeof id === "string" && id ? id : null
}

export function ShareToLinkedInButton({ source, variant = "icon" }: { source: Source; variant?: "icon" | "full" }) {
  const [state, setState] = useState<State>("idle")
  const [jobId, setJobId] = useState<string | null>(null)
  const [review, setReview] = useState<Review>(FALLBACK_REVIEW)
  const [existingPostId, setExistingPostId] = useState<string | null>(null)
  const job = useAiJob(jobId)

  useEffect(() => {
    if (state !== "writing" || !jobId) return
    if (job.status === "completed") {
      if (job.result && "skipped" in job.result) {
        toast.error("The agent decided not to draft this one")
        setJobId(null)
        setState("idle")
      } else {
        setState("ready")
      }
    } else if (job.status === "failed" || job.status === "cancelled") {
      toast.error(`Couldn't write the LinkedIn post: ${job.error ?? "unknown error"}`)
      setJobId(null)
      setState("idle")
    }
  }, [state, jobId, job.status, job.error, job.result])

  async function share() {
    if (state !== "idle") return
    setState("requesting")
    try {
      const res = await fetch("/api/admin/social/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(source),
      })
      const data = (await res.json().catch(() => ({}))) as {
        jobId?: string
        existingPostId?: string
        review?: Review
        error?: string
      }
      if (data.review) setReview(data.review)
      if (res.status === 202 && data.jobId) {
        setJobId(data.jobId)
        setState("writing")
      } else if (res.ok && data.existingPostId) {
        setExistingPostId(data.existingPostId)
        setState("exists")
      } else {
        toast.error(data.error ?? "Couldn't start the LinkedIn post")
        setState("idle")
      }
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.")
      setState("idle")
    }
  }

  if (state === "ready" || state === "exists") {
    const postId = state === "exists" ? existingPostId : draftIdFromJob(job.result)
    const href = review.postHrefPrefix && postId ? `${review.postHrefPrefix}${postId}` : review.listHref
    return (
      <Link
        href={href}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-primary bg-primary/10 hover:bg-primary/15 transition-colors"
      >
        {state === "ready" ? `Draft ready → review in ${review.label}` : `Draft already in ${review.label}`}
        <ArrowRight className="size-3" />
      </Link>
    )
  }

  const busy = state === "requesting" || state === "writing"
  const label = state === "writing" ? "Writing LinkedIn post…" : "Share to LinkedIn"
  return (
    <button
      type="button"
      onClick={share}
      disabled={busy}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-60",
        variant === "icon" ? "p-1.5" : "px-3 py-1.5 text-sm border border-border",
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Linkedin className="size-4" />}
      {variant === "full" || state === "writing" ? <span className="text-xs">{label}</span> : null}
    </button>
  )
}
