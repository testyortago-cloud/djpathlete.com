import { notFound } from "next/navigation"
import { getDrawerDataForPost } from "@/lib/content-studio/drawer-data"
import { detailBackInfo } from "@/lib/content-studio/detail-nav"
import { VideoDetailPage } from "@/components/admin/content-studio/detail/VideoDetailPage"
import { PostDetailPage } from "@/components/admin/content-studio/detail/PostDetailPage"

interface PageProps {
  params: Promise<{ postId: string }>
  searchParams: Promise<{ tab?: string }>
}

export default async function ContentStudioPostPage({ params, searchParams }: PageProps) {
  const { postId } = await params
  const { tab } = await searchParams

  const data = await getDrawerDataForPost(postId)
  if (!data) notFound()

  const back = detailBackInfo(tab ?? "posts")

  if (data.mode === "video") {
    return (
      <VideoDetailPage
        data={data}
        backHref={back.href}
        backLabel={back.label}
        highlightPostId={data.highlightPostId}
      />
    )
  }

  return <PostDetailPage data={data} backHref={back.href} backLabel={back.label} />
}
