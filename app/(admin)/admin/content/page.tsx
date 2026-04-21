import { getPipelineData } from "@/lib/content-studio/pipeline-data"
import { PipelineBoard } from "@/components/admin/content-studio/pipeline/PipelineBoard"
import { VideosList } from "@/components/admin/content-studio/list/VideosList"
import { PostsList } from "@/components/admin/content-studio/list/PostsList"
import { TabPlaceholder } from "@/components/admin/content-studio/TabPlaceholder"

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

export default async function ContentStudioPage({ searchParams }: PageProps) {
  const { tab } = await searchParams
  const data = await getPipelineData()

  switch (tab) {
    case "calendar":
      return <TabPlaceholder tabName="Calendar" phaseLabel="Phase 4" />
    case "videos":
      return <VideosList videos={data.videos} />
    case "posts":
      return <PostsList posts={data.posts} />
    default:
      return <PipelineBoard initialData={data} />
  }
}
