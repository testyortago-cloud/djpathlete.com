import { redirect } from "next/navigation"
import { Sparkles, Clock, CheckCircle } from "lucide-react"
import { listSocialPosts } from "@/lib/db/social-posts"
import { SocialPostsList } from "@/components/admin/social/SocialPostsList"
import { isContentStudioEnabled } from "@/lib/content-studio/feature-flag"
import type { SocialPost } from "@/types/database"

export const metadata = { title: "Social" }

export default async function SocialPage() {
  if (isContentStudioEnabled()) {
    redirect("/admin/content?tab=posts")
  }
  const posts: SocialPost[] = await listSocialPosts()

  const drafts = posts.filter((p) => p.approval_status === "draft" || p.approval_status === "edited").length
  const awaiting = posts.filter((p) => p.approval_status === "awaiting_connection").length
  const approved = posts.filter((p) => p.approval_status === "approved").length
  const published = posts.filter((p) => p.approval_status === "published").length

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-1">Social</h1>
      <p className="text-sm text-muted-foreground mb-6">
        AI-generated captions for every connected platform. Edit, approve, or reject each one.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
            <Sparkles className="size-3.5 sm:size-4 text-warning" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">To review</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{drafts}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10">
            <Clock className="size-3.5 sm:size-4 text-accent" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Awaiting connection</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{awaiting}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <CheckCircle className="size-3.5 sm:size-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Approved</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{approved}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-success/10">
            <CheckCircle className="size-3.5 sm:size-4 text-success" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Published</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{published}</p>
          </div>
        </div>
      </div>

      <SocialPostsList initialPosts={posts} />
    </div>
  )
}
