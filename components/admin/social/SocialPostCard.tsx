"use client"

import { useState } from "react"
import { Check, X, Pencil, Calendar, CalendarX, Zap, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { SchedulePickerDialog } from "./SchedulePickerDialog"
import type { SocialPost } from "@/types/database"
import { PLATFORM_ICONS, PLATFORM_LABELS } from "@/lib/social/platform-ui"

interface SocialPostCardProps {
  post: SocialPost
  onUpdate: (post: SocialPost) => void
  onRemove: (id: string) => void
  selectable?: boolean
  selected?: boolean
  onToggleSelected?: (id: string, selected: boolean) => void
}

type BusyAction = "approve" | "reject" | "save" | "unschedule" | "publishNow" | null

export function SocialPostCard({
  post,
  onUpdate,
  selectable = false,
  selected = false,
  onToggleSelected,
}: SocialPostCardProps) {
  const [editing, setEditing] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [draftContent, setDraftContent] = useState(post.content)
  const [busy, setBusy] = useState<BusyAction>(null)
  const Icon = PLATFORM_ICONS[post.platform]

  async function approve() {
    setBusy("approve")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/approve`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const { approval_status } = (await res.json()) as { approval_status: SocialPost["approval_status"] }
      onUpdate({ ...post, approval_status })
      toast.success(
        approval_status === "awaiting_connection" ? "Approved — waiting for platform connection" : "Approved",
      )
    } catch (error) {
      toast.error((error as Error).message || "Approve failed")
    } finally {
      setBusy(null)
    }
  }

  async function reject() {
    setBusy("reject")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rejection_notes: null }),
      })
      if (!res.ok) throw new Error(await res.text())
      onUpdate({ ...post, approval_status: "rejected" })
      toast.success("Rejected")
    } catch (error) {
      toast.error((error as Error).message || "Reject failed")
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (draftContent.trim() === post.content.trim()) {
      setEditing(false)
      return
    }
    setBusy("save")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caption_text: draftContent, hashtags: [] }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { content: string; approval_status: SocialPost["approval_status"] }
      onUpdate({ ...post, content: data.content, approval_status: data.approval_status })
      setEditing(false)
      toast.success("Caption updated")
    } catch (error) {
      toast.error((error as Error).message || "Save failed")
    } finally {
      setBusy(null)
    }
  }

  async function unschedule() {
    setBusy("unschedule")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/unschedule`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { approval_status: SocialPost["approval_status"]; scheduled_at: string | null }
      onUpdate({ ...post, approval_status: data.approval_status, scheduled_at: data.scheduled_at })
      toast.success("Unscheduled")
    } catch (error) {
      toast.error((error as Error).message || "Unschedule failed")
    } finally {
      setBusy(null)
    }
  }

  async function publishNow() {
    setBusy("publishNow")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/publish-now`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { approval_status: SocialPost["approval_status"]; scheduled_at: string | null }
      onUpdate({
        ...post,
        approval_status: data.approval_status,
        scheduled_at: data.scheduled_at,
        rejection_notes: null,
      })
      toast.success("Queued for next publish cycle (≤5 min)")
    } catch (error) {
      toast.error((error as Error).message || "Publish now failed")
    } finally {
      setBusy(null)
    }
  }

  const canSchedule = post.approval_status === "approved" || post.approval_status === "scheduled"
  const canUnschedule = post.approval_status === "scheduled"
  const canPublishNow = post.approval_status === "approved" || post.approval_status === "failed"
  const showFailedBanner = post.approval_status === "failed" && post.rejection_notes

  return (
    <>
      <div className="bg-white rounded-xl border border-border p-4">
        <div className="flex items-center gap-3 mb-3">
          {selectable && onToggleSelected && (
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onToggleSelected(post.id, e.target.checked)}
              aria-label={`Select ${PLATFORM_LABELS[post.platform]} post`}
              className="size-4 rounded border-border text-primary focus:ring-primary/30"
            />
          )}
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="size-4 text-primary" />
          </div>
          <p className="font-medium text-primary">{PLATFORM_LABELS[post.platform]}</p>
          <span className="text-xs text-muted-foreground ml-auto">
            {post.scheduled_at
              ? `Scheduled ${new Date(post.scheduled_at).toLocaleString()}`
              : new Date(post.created_at).toLocaleDateString()}
          </span>
        </div>

        {showFailedBanner && (
          <div
            role="alert"
            className="mb-3 rounded-md border border-error/30 bg-error/5 p-3 flex items-start gap-2 text-xs text-error"
          >
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Publish failed</p>
              <p className="mt-0.5">{post.rejection_notes}</p>
            </div>
          </div>
        )}

        {editing ? (
          <textarea
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            rows={6}
            className="w-full rounded-md border border-border p-3 text-sm font-body bg-surface resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        ) : (
          <pre className="whitespace-pre-wrap text-sm text-primary font-body">{post.content}</pre>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {editing ? (
            <>
              <button
                type="button"
                onClick={save}
                disabled={busy !== null}
                className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {busy === "save" ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftContent(post.content)
                  setEditing(false)
                }}
                disabled={busy !== null}
                className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-muted-foreground hover:text-primary"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={approve}
                disabled={busy !== null || post.approval_status === "published"}
                className="text-xs px-3 py-1.5 rounded-md bg-success/10 text-success hover:bg-success/20 disabled:opacity-60 inline-flex items-center gap-1"
              >
                <Check className="size-3" /> {busy === "approve" ? "Approving..." : "Approve"}
              </button>
              {canSchedule && (
                <button
                  type="button"
                  onClick={() => setScheduleOpen(true)}
                  disabled={busy !== null}
                  className="text-xs px-3 py-1.5 rounded-md bg-accent/10 text-accent hover:bg-accent/20 inline-flex items-center gap-1"
                >
                  <Calendar className="size-3" /> {post.scheduled_at ? "Reschedule" : "Schedule"}
                </button>
              )}
              {canUnschedule && (
                <button
                  type="button"
                  onClick={unschedule}
                  disabled={busy !== null}
                  className="text-xs px-3 py-1.5 rounded-md bg-warning/10 text-warning hover:bg-warning/20 inline-flex items-center gap-1"
                >
                  <CalendarX className="size-3" /> {busy === "unschedule" ? "Unscheduling..." : "Unschedule"}
                </button>
              )}
              {canPublishNow && (
                <button
                  type="button"
                  onClick={publishNow}
                  disabled={busy !== null}
                  className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 inline-flex items-center gap-1"
                >
                  <Zap className="size-3" />{" "}
                  {busy === "publishNow"
                    ? "Queueing..."
                    : post.approval_status === "failed"
                      ? "Retry now"
                      : "Publish now"}
                </button>
              )}
              <button
                type="button"
                onClick={reject}
                disabled={busy !== null || post.approval_status === "rejected"}
                className="text-xs px-3 py-1.5 rounded-md bg-error/10 text-error hover:bg-error/20 disabled:opacity-60 inline-flex items-center gap-1"
              >
                <X className="size-3" /> Reject
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy !== null}
                className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10 inline-flex items-center gap-1"
              >
                <Pencil className="size-3" /> Edit
              </button>
            </>
          )}
        </div>
      </div>

      <SchedulePickerDialog
        post={post}
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        onScheduled={(updated) => {
          onUpdate(updated)
          setScheduleOpen(false)
        }}
      />
    </>
  )
}
