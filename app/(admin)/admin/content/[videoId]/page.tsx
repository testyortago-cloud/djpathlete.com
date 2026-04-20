import { TabPlaceholder } from "@/components/admin/content-studio/TabPlaceholder"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"

interface PageProps {
  params: Promise<{ videoId: string }>
  searchParams: Promise<{ tab?: string }>
}

export default async function ContentStudioDrawerPage({ params, searchParams }: PageProps) {
  const { videoId } = await params
  const { tab } = await searchParams

  let tabContent: React.ReactNode
  switch (tab) {
    case "calendar":
      tabContent = <TabPlaceholder tabName="Calendar" phaseLabel="Phase 4" />
      break
    case "videos":
      tabContent = <TabPlaceholder tabName="Videos" phaseLabel="Phase 3" />
      break
    case "posts":
      tabContent = <TabPlaceholder tabName="Posts" phaseLabel="Phase 3" />
      break
    default:
      tabContent = <TabPlaceholder tabName="Pipeline" phaseLabel="Phase 3" />
  }

  return (
    <>
      {tabContent}
      <DetailDrawer videoId={videoId} />
    </>
  )
}
