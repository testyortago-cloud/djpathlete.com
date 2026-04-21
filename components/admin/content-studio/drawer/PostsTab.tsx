"use client"

import { useState, useEffect } from "react"
import { Megaphone } from "lucide-react"
import { PostsTabRow } from "./PostsTabRow"
import type { SocialPost } from "@/types/database"

interface PostsTabProps {
  posts: SocialPost[]
  /** Post id that should start expanded (from ?postId= query). */
  initialExpandedPostId: string | null
}

export function PostsTab({ posts: initialPosts, initialExpandedPostId }: PostsTabProps) {
  const [posts, setPosts] = useState(initialPosts)
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedPostId)

  useEffect(() => {
    setPosts(initialPosts)
  }, [initialPosts])

  useEffect(() => {
    setExpandedId(initialExpandedPostId)
  }, [initialExpandedPostId])

  // Scroll the deep-linked row into view on mount
  useEffect(() => {
    if (!initialExpandedPostId) return
    const el = document.querySelector(`[data-post-id="${initialExpandedPostId}"]`)
    if (el && typeof (el as HTMLElement).scrollIntoView === "function") {
      (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [initialExpandedPostId])

  function toggle(postId: string) {
    setExpandedId((prev) => (prev === postId ? null : postId))
  }

  function mutate(updated: SocialPost) {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  if (posts.length === 0) {
    return (
      <div className="py-12 text-center">
        <Megaphone className="size-8 text-muted-foreground mx-auto mb-2" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">No posts generated yet.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Run the social fanout from the video card to generate 6 captions.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 px-6 py-4">
      {posts.map((post) => (
        <PostsTabRow
          key={post.id}
          post={post}
          isExpanded={expandedId === post.id}
          onToggle={toggle}
          onMutate={mutate}
        />
      ))}
    </div>
  )
}
