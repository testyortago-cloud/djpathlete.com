"use client"

import { useState } from "react"
import { Zap, Calendar } from "lucide-react"
import { toast } from "sonner"
import type { SocialPost } from "@/types/database"
import { BatchScheduleDialog } from "./BatchScheduleDialog"

/**
 * Posts that a batch action can act on: anything not already published or
 * rejected. Mirrors the per-row `showActions` gate (PostsTabRow).
 */
export function eligibleForBatch(posts: SocialPost[]): SocialPost[] {
  return posts.filter((p) => p.approval_status !== "published" && p.approval_status !== "rejected")
}

interface BatchPostActionsProps {
  posts: SocialPost[]
  /** Whether the source video is postable (cut rendered or marked ready). When
   *  false the buttons are disabled with a hint — matching the per-post edit gate. */
  isReady: boolean
  onMutate: (updated: SocialPost) => void
}

export function BatchPostActions({ posts, isReady, onMutate }: BatchPostActionsProps) {
  const [busy, setBusy] = useState<null | "publish" | "schedule">(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)

  const eligible = eligibleForBatch(posts)
  if (eligible.length === 0) return null

  async function publishAll() {
    setBusy("publish")
    let ok = 0
    let failed = 0
    for (const post of eligible) {
      try {
        const res = await fetch(`/api/admin/social/posts/${post.id}/publish-now`, { method: "POST" })
        if (!res.ok) throw new Error(await res.text())
        const data = (await res.json()) as Pick<SocialPost, "approval_status" | "scheduled_at">
        onMutate({ ...post, ...data, rejection_notes: null })
        ok++
      } catch {
        failed++
      }
    }
    setBusy(null)
    if (failed === 0) toast.success(`Queued ${ok} post${ok === 1 ? "" : "s"} to publish (≤5 min)`)
    else if (ok > 0) toast.error(`Queued ${ok}, but ${failed} failed`)
    else toast.error("Couldn't queue any posts")
  }

  async function scheduleAll(scheduledAtIso: string) {
    setBusy("schedule")
    let ok = 0
    let failed = 0
    let skipped = 0
    for (const post of eligible) {
      // Stories can't be scheduled (mirrors the per-row rule) — only published live.
      if (post.post_type === "story") {
        skipped++
        continue
      }
      try {
        const res = await fetch(`/api/admin/social/posts/${post.id}/schedule`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scheduled_at: scheduledAtIso }),
        })
        if (!res.ok) throw new Error(await res.text())
        const data = (await res.json()) as Pick<SocialPost, "approval_status" | "scheduled_at">
        onMutate({ ...post, approval_status: data.approval_status, scheduled_at: data.scheduled_at })
        ok++
      } catch {
        failed++
      }
    }
    setBusy(null)
    setScheduleOpen(false)
    const tail = skipped > 0 ? ` (${skipped} story post${skipped === 1 ? "" : "s"} skipped)` : ""
    if (failed === 0) toast.success(`Scheduled ${ok} post${ok === 1 ? "" : "s"}${tail}`)
    else if (ok > 0) toast.error(`Scheduled ${ok}, but ${failed} failed${tail}`)
    else toast.error("Couldn't schedule any posts")
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/40 px-4 py-2.5">
      <span className="text-xs font-medium text-primary">
        {eligible.length} post{eligible.length === 1 ? "" : "s"} ready to send
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={publishAll}
          disabled={!isReady || busy !== null}
          aria-label="Publish all posts"
          title={isReady ? "Queue every post to publish on the next cycle" : "Render a cut or Mark ready first"}
          className="inline-flex items-center gap-1 rounded-md bg-success/10 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/20 disabled:opacity-50"
        >
          <Zap className="size-3" /> {busy === "publish" ? "Queueing…" : "Publish all"}
        </button>
        <button
          type="button"
          onClick={() => setScheduleOpen(true)}
          disabled={!isReady || busy !== null}
          aria-label="Schedule all posts"
          title={isReady ? "Schedule every post for a chosen time" : "Render a cut or Mark ready first"}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Calendar className="size-3" /> Schedule all
        </button>
      </div>
      {!isReady && (
        <p className="w-full text-[11px] text-muted-foreground">
          Render a captioned cut or “Mark ready” before sending these posts.
        </p>
      )}
      <BatchScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        count={eligible.filter((p) => p.post_type !== "story").length}
        busy={busy === "schedule"}
        onConfirm={scheduleAll}
      />
    </div>
  )
}
