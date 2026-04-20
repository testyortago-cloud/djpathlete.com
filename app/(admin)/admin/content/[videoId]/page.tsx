import { TabContent } from "@/components/admin/content-studio/TabContent"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"

interface PageProps {
  params: Promise<{ videoId: string }>
  searchParams: Promise<{ tab?: string }>
}

export default async function ContentStudioDrawerPage({ params, searchParams }: PageProps) {
  const { videoId } = await params
  const { tab } = await searchParams

  return (
    <>
      <TabContent tab={tab} />
      <DetailDrawer videoId={videoId} />
    </>
  )
}
