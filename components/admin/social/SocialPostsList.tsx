"use client"

import { useState } from "react"
import { Megaphone } from "lucide-react"
import { SocialPostCard } from "./SocialPostCard"
import type { SocialPost } from "@/types/database"

interface SocialPostsListProps {
  initialPosts: SocialPost[]
}

const SECTIONS: Array<{ key: SocialPost["approval_status"] | "to_review"; label: string }> = [
  { key: "to_review", label: "To review" },
  { key: "awaiting_connection", label: "Awaiting platform connection" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" },
  { key: "rejected", label: "Rejected" },
]

export function SocialPostsList({ initialPosts }: SocialPostsListProps) {
  const [posts, setPosts] = useState(initialPosts)

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

  function onUpdate(updated: SocialPost) {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  function onRemove(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="space-y-6">
      {SECTIONS.map((section) => {
        const sectionPosts = posts.filter((p) => {
          if (section.key === "to_review") return p.approval_status === "draft" || p.approval_status === "edited"
          return p.approval_status === section.key
        })
        if (sectionPosts.length === 0) return null

        return (
          <section key={section.key}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {section.label} ({sectionPosts.length})
            </h2>
            <div className="space-y-3">
              {sectionPosts.map((post) => (
                <SocialPostCard key={post.id} post={post} onUpdate={onUpdate} onRemove={onRemove} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
