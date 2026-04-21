"use client"

import { useState } from "react"
import {
  Facebook,
  Instagram,
  Music2,
  Youtube,
  Linkedin,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Zap,
} from "lucide-react"
import { toast } from "sonner"
import type { SocialPost, SocialPlatform, SocialApprovalStatus } from "@/types/database"
import { cn } from "@/lib/utils"

const PLATFORM_ICONS: Record<SocialPlatform, typeof Facebook> = {
  facebook: Facebook,
  instagram: Instagram,
  tiktok: Music2,
  youtube: Youtube,
  youtube_shorts: Youtube,
  linkedin: Linkedin,
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  youtube_shorts: "YouTube Shorts",
  linkedin: "LinkedIn",
}

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

// UI-facing labels — map raw status enum values to the labels users read in
// the pipeline. "draft" and "edited" both surface as "Needs review" because
// the coach's mental model is "posts I haven't acted on yet."
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
  const [busy, setBusy] = useState<"approve" | "schedule" | "retry" | "save" | null>(null)
  const Icon = PLATFORM_ICONS[post.platform]
  const isPublished = post.approval_status === "published"
  const isFailed = post.approval_status === "failed"

  async function approve() {
    setBusy("approve")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/approve`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const { approval_status } = (await res.json()) as {
        approval_status: SocialApprovalStatus
      }
      onMutate({ ...post, approval_status })
      toast.success("Approved")
    } catch (err) {
      toast.error((err as Error).message || "Approve failed")
    } finally {
      setBusy(null)
    }
  }

  async function retry() {
    setBusy("retry")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/publish-now`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as Pick<SocialPost, "approval_status" | "scheduled_at">
      onMutate({ ...post, ...data, rejection_notes: null })
      toast.success("Requeued for publishing")
    } catch (err) {
      toast.error((err as Error).message || "Retry failed")
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

  function handleScheduleStub() {
    toast.info("Open the Calendar tab to drop this on a day — schedule picker lands in Phase 4.")
  }

  return (
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
            <span className="text-sm font-medium text-primary">
              {PLATFORM_LABELS[post.platform]}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full",
                STATUS_PILL_CLASSES[post.approval_status],
              )}
            >
              {STATUS_LABELS[post.approval_status]}
            </span>
            {post.scheduled_at && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(post.scheduled_at).toLocaleString()}
              </span>
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
              disabled={isPublished}
              className="mt-1 w-full rounded-md border border-border p-2 text-sm font-body bg-surface/40 disabled:opacity-60"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {!isPublished && (
              <button
                type="button"
                onClick={save}
                disabled={busy !== null || draft.trim() === post.content.trim()}
                className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10 disabled:opacity-60"
              >
                {busy === "save" ? "Saving..." : "Save caption"}
              </button>
            )}
            {!isPublished && post.approval_status !== "approved" && (
              <button
                type="button"
                onClick={approve}
                disabled={busy !== null}
                className="text-xs px-3 py-1.5 rounded-md bg-success/10 text-success hover:bg-success/20 disabled:opacity-60"
              >
                {busy === "approve" ? "Approving..." : "Approve"}
              </button>
            )}
            {!isPublished && (
              <button
                type="button"
                onClick={handleScheduleStub}
                disabled={busy !== null}
                className="text-xs px-3 py-1.5 rounded-md bg-accent/10 text-accent hover:bg-accent/20"
              >
                Schedule
              </button>
            )}
            {isFailed && (
              <button
                type="button"
                onClick={retry}
                disabled={busy !== null}
                className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 inline-flex items-center gap-1"
              >
                <Zap className="size-3" /> {busy === "retry" ? "Retrying..." : "Retry"}
              </button>
            )}
            {isPublished && (
              <span className="text-xs text-muted-foreground">
                Published{" "}
                {post.published_at ? new Date(post.published_at).toLocaleString() : ""}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
