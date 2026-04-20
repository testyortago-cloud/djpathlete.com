"use client"

import { useState } from "react"
import { Facebook, Instagram, Music2, Youtube, Linkedin, Check, X, Pencil } from "lucide-react"
import { toast } from "sonner"
import type { SocialPost, SocialPlatform } from "@/types/database"

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

interface SocialPostCardProps {
  post: SocialPost
  onUpdate: (post: SocialPost) => void
  onRemove: (id: string) => void
}

export function SocialPostCard({ post, onUpdate }: SocialPostCardProps) {
  const [editing, setEditing] = useState(false)
  const [draftContent, setDraftContent] = useState(post.content)
  const [busy, setBusy] = useState<"approve" | "reject" | "save" | null>(null)
  const Icon = PLATFORM_ICONS[post.platform]

  async function approve() {
    setBusy("approve")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/approve`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const { approval_status } = (await res.json()) as { approval_status: SocialPost["approval_status"] }
      onUpdate({ ...post, approval_status })
      toast.success(approval_status === "awaiting_connection" ? "Approved — waiting for platform connection" : "Approved")
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

  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="size-4 text-primary" />
        </div>
        <p className="font-medium text-primary">{PLATFORM_LABELS[post.platform]}</p>
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(post.created_at).toLocaleDateString()}
        </span>
      </div>

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

      <div className="flex items-center gap-2 mt-3">
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
  )
}
