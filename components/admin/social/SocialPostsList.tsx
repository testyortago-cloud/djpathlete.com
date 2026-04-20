"use client"

import { useState, useMemo } from "react"
import { Megaphone, Check, XCircle } from "lucide-react"
import { toast } from "sonner"
import { SocialPostCard } from "./SocialPostCard"
import type { SocialPost } from "@/types/database"

interface SocialPostsListProps {
  initialPosts: SocialPost[]
}

const SELECTABLE_SECTION_KEYS = new Set(["to_review", "awaiting_connection"])

const SECTIONS: Array<{ key: SocialPost["approval_status"] | "to_review"; label: string }> = [
  { key: "to_review", label: "To review" },
  { key: "awaiting_connection", label: "Awaiting platform connection" },
  { key: "approved", label: "Approved" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
  { key: "failed", label: "Failed" },
  { key: "rejected", label: "Rejected" },
]

export function SocialPostsList({ initialPosts }: SocialPostsListProps) {
  const [posts, setPosts] = useState(initialPosts)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchBusy, setBatchBusy] = useState(false)

  const sectionedPosts = useMemo(() => {
    return SECTIONS.map((section) => ({
      ...section,
      posts: posts.filter((p) => {
        if (section.key === "to_review") return p.approval_status === "draft" || p.approval_status === "edited"
        return p.approval_status === section.key
      }),
    }))
  }, [posts])

  function onUpdate(updated: SocialPost) {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  function onRemove(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id))
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function toggleSelected(id: string, selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (selected) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function toggleSelectAll(sectionPosts: SocialPost[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allSelected = sectionPosts.every((p) => next.has(p.id))
      for (const p of sectionPosts) {
        if (allSelected) next.delete(p.id)
        else next.add(p.id)
      }
      return next
    })
  }

  async function batchApprove() {
    if (selectedIds.size === 0) return
    setBatchBusy(true)
    const ids = Array.from(selectedIds)
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/admin/social/posts/${id}/approve`, { method: "POST" }).then(async (res) => {
          if (!res.ok) throw new Error(await res.text())
          return (await res.json()) as { id: string; approval_status: SocialPost["approval_status"] }
        }),
      ),
    )

    const updates = new Map<string, SocialPost["approval_status"]>()
    let ok = 0
    let fail = 0
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        ok++
        updates.set(ids[i], r.value.approval_status)
      } else {
        fail++
      }
    })

    setPosts((prev) =>
      prev.map((p) => (updates.has(p.id) ? { ...p, approval_status: updates.get(p.id)! } : p)),
    )
    setSelectedIds(new Set())
    setBatchBusy(false)

    if (fail === 0) toast.success(`Approved ${ok} post${ok === 1 ? "" : "s"}`)
    else toast.error(`Approved ${ok}, failed ${fail}`)
  }

  if (posts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-2">
          <Megaphone className="size-5 text-primary" />
          <h2 className="font-semibold text-primary">No social posts yet</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload a coaching video in the Videos tab, click Transcribe, then click Generate Social — captions will appear here.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6 pb-24">
        {sectionedPosts.map((section) => {
          if (section.posts.length === 0) return null

          const isSelectable = SELECTABLE_SECTION_KEYS.has(section.key)
          const sectionSelectedCount = section.posts.filter((p) => selectedIds.has(p.id)).length
          const allSelected = sectionSelectedCount === section.posts.length && section.posts.length > 0

          return (
            <section key={section.key}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {section.label} ({section.posts.length})
                </h2>
                {isSelectable && (
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(section.posts)}
                    className="text-xs text-primary hover:underline"
                  >
                    {allSelected ? "Deselect all" : "Select all"}
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {section.posts.map((post) => (
                  <SocialPostCard
                    key={post.id}
                    post={post}
                    onUpdate={onUpdate}
                    onRemove={onRemove}
                    selectable={isSelectable}
                    selected={selectedIds.has(post.id)}
                    onToggleSelected={toggleSelected}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {selectedIds.size > 0 && (
        <div
          role="toolbar"
          aria-label="Batch actions"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white rounded-full border border-border shadow-lg px-4 py-2 flex items-center gap-3"
        >
          <span className="text-sm text-primary font-medium">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={batchApprove}
            disabled={batchBusy}
            className="text-xs px-3 py-1.5 rounded-md bg-success/10 text-success hover:bg-success/20 disabled:opacity-60 inline-flex items-center gap-1"
          >
            <Check className="size-3" /> {batchBusy ? "Approving..." : "Approve selected"}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={batchBusy}
            className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          >
            <XCircle className="size-3" /> Clear
          </button>
        </div>
      )}
    </>
  )
}
