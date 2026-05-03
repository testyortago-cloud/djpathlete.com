import { Suspense } from "react"
import { FileText, Send, Clock, Sparkles } from "lucide-react"
import { getBlogPosts } from "@/lib/db/blog-posts"
import { BlogPageTabs } from "@/components/admin/blog/BlogPageTabs"
import { BlogJobTracker } from "@/components/admin/blog/BlogJobTracker"
import type { BlogPost } from "@/types/database"

export const metadata = { title: "Blog" }

export default async function BlogPage() {
  const posts = (await getBlogPosts()) as BlogPost[]

  const total = posts.length
  const published = posts.filter((p) => p.status === "published").length
  const drafts = posts.filter((p) => p.status === "draft").length

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Blog</h1>

      <Suspense fallback={null}>
        <BlogJobTracker />
      </Suspense>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="size-3.5 sm:size-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Total Posts</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{total}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-success/10">
            <Send className="size-3.5 sm:size-4 text-success" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Published</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{published}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
            <Clock className="size-3.5 sm:size-4 text-warning" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Drafts</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{drafts}</p>
          </div>
        </div>
      </div>

      <BlogPageTabs posts={posts} />
    </div>
  )
}
