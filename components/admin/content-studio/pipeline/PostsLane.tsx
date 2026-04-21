"use client"

import { useState, useEffect } from "react"
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { POST_COLUMNS, POST_COLUMN_LABELS, postsByColumn, type PostColumn } from "@/lib/content-studio/pipeline-columns"
import { Lane, LaneColumn } from "./Lane"
import { PostCard } from "./PostCard"
import type { PipelinePostRow } from "@/lib/db/social-posts"
import type { SocialApprovalStatus } from "@/types/database"

interface PostsLaneProps {
  posts: PipelinePostRow[]
  selectedIds: Set<string>
  onToggleSelected: (postId: string, selected: boolean) => void
}

// Column → DB status for optimistic update (must mirror the API's columnToStatus).
function columnToStatus(column: PostColumn): SocialApprovalStatus | null {
  switch (column) {
    case "needs_review":
      return "draft"
    case "approved":
      return "approved"
    case "failed":
      return "failed"
    case "scheduled":
    case "published":
      return null
  }
}

export function PostsLane({ posts: initialPosts, selectedIds, onToggleSelected }: PostsLaneProps) {
  const [posts, setPosts] = useState(initialPosts)
  const router = useRouter()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Keep local state in sync if server data changes under us (e.g. after refresh).
  useEffect(() => {
    setPosts(initialPosts)
  }, [initialPosts])

  const grouped = postsByColumn(posts)

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const overId = String(over.id)
    if (!overId.startsWith("post-")) return
    const targetColumn = overId.slice("post-".length) as PostColumn

    const post = posts.find((p) => p.id === active.id)
    if (!post) return

    if (targetColumn === "scheduled" || targetColumn === "published") {
      toast.info(
        targetColumn === "scheduled"
          ? "Use the Schedule action on the card to pick a date"
          : "Posts publish automatically when scheduled time arrives",
      )
      return
    }

    const nextStatus = columnToStatus(targetColumn)
    if (!nextStatus) return
    if (post.approval_status === nextStatus) return

    const prevStatus = post.approval_status
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, approval_status: nextStatus } : p)))

    try {
      const res = await fetch(`/api/admin/content-studio/posts/${post.id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetColumn }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Move failed")
      toast.success(`Moved to ${POST_COLUMN_LABELS[targetColumn]}`)
      router.refresh()
    } catch (err) {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, approval_status: prevStatus } : p)))
      toast.error((err as Error).message || "Move failed")
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <Lane title="Posts" subtitle="Drag between columns to approve, reject, or retry">
        {POST_COLUMNS.map((col) => (
          <LaneColumn
            key={col}
            id={`post-${col}`}
            label={POST_COLUMN_LABELS[col]}
            count={grouped[col].length}
            accepts={col !== "scheduled" && col !== "published"}
          >
            {grouped[col].map((p) => (
              <PostCard key={p.id} post={p} selected={selectedIds.has(p.id)} onToggleSelected={onToggleSelected} />
            ))}
            {grouped[col].length === 0 && (
              <div className="py-6 text-center text-[11px] text-muted-foreground/60 italic">empty</div>
            )}
          </LaneColumn>
        ))}
      </Lane>
    </DndContext>
  )
}
