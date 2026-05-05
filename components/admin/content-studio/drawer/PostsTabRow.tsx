"use client"

import { useState } from "react"
import { AlertCircle, Calendar, CalendarX, ChevronDown, ChevronRight, Zap } from "lucide-react"
import { toast } from "sonner"
import type { SocialPost, SocialApprovalStatus } from "@/types/database"
import { cn } from "@/lib/utils"
import { PLATFORM_ICONS, PLATFORM_LABELS } from "@/lib/social/platform-ui"
import { SchedulePickerDialog } from "@/components/admin/social/SchedulePickerDialog"

const STATUS_PILL_CLASSES: Record<SocialApprovalStatus, string> = {
  draft: "bg-warning/10 text-warning",
  edited: "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  scheduled: "bg-accent/10 text-accent",
  published: "bg-primary/10 text-primary",
  rejected: "bg-error/10 text-error",
  awaiting_connection: "bg-warning/10 text-warning",
  failed: "bg-error/10 text-error",
}

// "draft" and "edited" both surface as "Needs review" because the coach's
// mental model is "posts I haven't acted on yet."
const STATUS_LABELS: Record<SocialApprovalStatus, string> = {
  draft: "Needs review",
  edited: "Needs review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
  rejected: "Rejected",
  awaiting_connection: "Awaiting connection",
  failed: "Failed",
}

interface PostsTabRowProps {
  post: SocialPost
  isExpanded: boolean
  onToggle: (postId: string) => void
  onMutate: (updated: SocialPost) => void
}

export function PostsTabRow({ post, isExpanded, onToggle, onMutate }: PostsTabRowProps) {
  const [draft, setDraft] = useState(post.content)
  const [busy, setBusy] = useState<"publishNow" | "unschedule" | "save" | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const Icon = PLATFORM_ICONS[post.platform]
  const isPublished = post.approval_status === "published"
  const isRejected = post.approval_status === "rejected"
  const isScheduled = post.approval_status === "scheduled"
  const isFailed = post.approval_status === "failed"
  const isStory = post.post_type === "story"
  const showActions = !isPublished && !isRejected

  async function publishNow() {
    setBusy("publishNow")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/publish-now`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as Pick<SocialPost, "approval_status" | "scheduled_at">
      onMutate({ ...post, ...data, rejection_notes: null })
      toast.success(isFailed ? "Requeued for publishing" : "Queued for next publish cycle (≤5 min)")
    } catch (err) {
      toast.error((err as Error).message || "Publish now failed")
    } finally {
      setBusy(null)
    }
  }

  async function unschedule() {
    setBusy("unschedule")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/unschedule`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as Pick<SocialPost, "approval_status" | "scheduled_at">
      onMutate({ ...post, ...data })
      toast.success("Unscheduled")
    } catch (err) {
      toast.error((err as Error).message || "Unschedule failed")
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (draft.trim() === post.content.trim()) return
    setBusy("save")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caption_text: draft, hashtags: [] }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as {
        content: string
        approval_status: SocialApprovalStatus
      }
      onMutate({ ...post, content: data.content, approval_status: data.approval_status })
      toast.success("Caption updated")
    } catch (err) {
      toast.error((err as Error).message || "Save failed")
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div
        data-post-id={post.id}
        className={cn(
          "border border-border rounded-lg bg-white overflow-hidden",
          isFailed && "border-error/40",
          isPublished && "opacity-75",
        )}
      >
        <button
          type="button"
          onClick={() => onToggle(post.id)}
          aria-label={isExpanded ? `Collapse post ${post.id}` : `Expand post ${post.id}`}
          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface/40"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="size-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-primary">{PLATFORM_LABELS[post.platform]}</span>
              <span
                className={cn(
                  "text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full",
                  STATUS_PILL_CLASSES[post.approval_status],
                )}
              >
                {STATUS_LABELS[post.approval_status]}
              </span>
              {post.scheduled_at && (
                <span className="text-[10px] text-muted-foreground">{new Date(post.scheduled_at).toLocaleString()}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{post.content}</p>
          </div>
          {isExpanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </button>

        {isExpanded && (
          <div className="px-4 pb-4 border-t border-border space-y-3">
            {isFailed && post.rejection_notes && (
              <div className="flex items-start gap-2 p-2 rounded-md bg-error/5 border border-error/20 text-xs text-error">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{post.rejection_notes}</span>
              </div>
            )}
            <label className="block text-xs text-muted-foreground">
              Caption
              <textarea
                aria-label="Caption"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={5}
                disabled={isPublished || isRejected}
                className="mt-1 w-full rounded-md border border-border p-2 text-sm font-body bg-surface/40 disabled:opacity-60"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {showActions && !isStory && (
                <button
                  type="button"
                  onClick={save}
                  disabled={busy !== null || draft.trim() === post.content.trim()}
                  className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10 disabled:opacity-60"
                >
                  {busy === "save" ? "Saving..." : "Save caption"}
                </button>
              )}
              {showActions && !isStory && (
                <button
                  type="button"
                  onClick={() => setScheduleOpen(true)}
                  disabled={busy !== null}
                  className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 inline-flex items-center gap-1"
                >
                  <Calendar className="size-3" /> {isScheduled ? "Reschedule" : "Schedule"}
                </button>
              )}
              {showActions && (
                <button
                  type="button"
                  onClick={publishNow}
                  disabled={busy !== null}
                  className="text-xs px-3 py-1.5 rounded-md bg-success/10 text-success hover:bg-success/20 disabled:opacity-60 inline-flex items-center gap-1"
                >
                  <Zap className="size-3" />{" "}
                  {busy === "publishNow" ? "Queueing..." : isFailed ? "Retry now" : "Publish now"}
                </button>
              )}
              {showActions && isScheduled && !isStory && (
                <button
                  type="button"
                  onClick={unschedule}
                  disabled={busy !== null}
                  className="text-xs px-3 py-1.5 rounded-md bg-warning/10 text-warning hover:bg-warning/20 disabled:opacity-60 inline-flex items-center gap-1"
                >
                  <CalendarX className="size-3" /> {busy === "unschedule" ? "Unscheduling..." : "Unschedule"}
                </button>
              )}
              {isPublished && (
                <span className="text-xs text-muted-foreground">
                  Published {post.published_at ? new Date(post.published_at).toLocaleString() : ""}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <SchedulePickerDialog
        post={post}
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        onScheduled={(updated) => {
          onMutate(updated)
          setScheduleOpen(false)
        }}
      />
    </>
  )
}
