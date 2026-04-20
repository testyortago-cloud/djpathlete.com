import { Sparkles, Clock, CheckCircle, Megaphone } from "lucide-react"
import { listSocialPosts } from "@/lib/db"
import type { SocialPost } from "@/types/database"

export const metadata = { title: "Social" }

export default async function SocialPage() {
  const posts = (await listSocialPosts()) as SocialPost[]

  const drafts = posts.filter((p) => p.approval_status === "draft").length
  const scheduled = posts.filter((p) => p.approval_status === "scheduled").length
  const published = posts.filter((p) => p.approval_status === "published").length

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Social</h1>
      <p className="text-sm text-muted-foreground mb-6">
        AI-generated captions for every connected platform. Edit, schedule, or push to draft.
      </p>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
            <Sparkles className="size-3.5 sm:size-4 text-warning" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Drafts</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{drafts}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Clock className="size-3.5 sm:size-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Scheduled</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{scheduled}</p>
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

      <div className="bg-white rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-2">
          <Megaphone className="size-5 text-primary" />
          <h2 className="font-semibold text-primary">No social posts yet</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload a coaching video in the Videos tab and the system will generate captions for every
          connected platform.
        </p>
      </div>
    </div>
  )
}
