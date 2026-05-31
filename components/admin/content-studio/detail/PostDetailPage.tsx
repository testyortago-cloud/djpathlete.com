import { FileText } from "lucide-react"
import type { DrawerData } from "@/lib/content-studio/drawer-data"
import { DetailBreadcrumb } from "./DetailBreadcrumb"
import { PostsTab } from "@/components/admin/content-studio/drawer/PostsTab"
import { MetaTab } from "@/components/admin/content-studio/drawer/MetaTab"

interface PostDetailPageProps {
  data: DrawerData
  backHref: string
  backLabel: string
}

export function PostDetailPage({ data, backHref, backLabel }: PostDetailPageProps) {
  return (
    <div className="max-w-3xl px-4 py-4 sm:px-6">
      <div className="mb-6 border-b border-border pb-4">
        <DetailBreadcrumb backHref={backHref} backLabel={backLabel} current="Manual post" />
        <h1 className="mt-2 inline-flex items-center gap-2 font-heading text-xl text-primary">
          <FileText className="size-5 text-muted-foreground" /> Manual post
        </h1>
      </div>

      <div className="space-y-8">
        <section>
          <PostsTab posts={data.posts} mediaByPost={data.mediaByPost} initialExpandedPostId={data.highlightPostId} />
        </section>
        <section aria-labelledby="post-meta-heading">
          <h2
            id="post-meta-heading"
            className="font-heading text-sm font-semibold text-primary border-b border-border pb-1.5 mb-3"
          >
            Details
          </h2>
          <MetaTab video={null} transcript={null} posts={data.posts} />
        </section>
      </div>
    </div>
  )
}
