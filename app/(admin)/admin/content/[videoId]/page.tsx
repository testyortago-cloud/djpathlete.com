import { notFound } from "next/navigation"
import { getDrawerData } from "@/lib/content-studio/drawer-data"
import { detailBackInfo } from "@/lib/content-studio/detail-nav"
import { VideoDetailPage } from "@/components/admin/content-studio/detail/VideoDetailPage"

interface PageProps {
  params: Promise<{ videoId: string }>
  searchParams: Promise<{ tab?: string; postId?: string }>
}

export default async function ContentStudioVideoPage({ params, searchParams }: PageProps) {
  const { videoId } = await params
  const { tab, postId } = await searchParams

  const data = await getDrawerData(videoId)
  if (!data) notFound()

  const back = detailBackInfo(tab)
  return (
    <VideoDetailPage
      data={data}
      backHref={back.href}
      backLabel={back.label}
      highlightPostId={postId ?? null}
    />
  )
}
