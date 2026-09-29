"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Linkedin, Loader2, ArrowRight } from "lucide-react"
import { toast } from "sonner"
import { useAiJob } from "@/hooks/use-ai-job"
import { cn } from "@/lib/utils"

type Source = { blogPostId: string } | { newsletterId: string }
type State = "idle" | "requesting" | "writing" | "ready" | "exists"

export function ShareToLinkedInButton({ source, variant = "icon" }: { source: Source; variant?: "icon" | "full" }) {
  const [state, setState] = useState<State>("idle")
  const [jobId, setJobId] = useState<string | null>(null)
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
      const data = (await res.json().catch(() => ({}))) as { jobId?: string; existingPostId?: string; error?: string }
      if (res.status === 202 && data.jobId) {
        setJobId(data.jobId)
        setState("writing")
      } else if (res.ok && data.existingPostId) {
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
    return (
      <Link
        href="/admin/social"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-primary bg-primary/10 hover:bg-primary/15 transition-colors"
      >
        {state === "ready" ? "Draft ready → review in Social" : "Draft already in Social"}
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
