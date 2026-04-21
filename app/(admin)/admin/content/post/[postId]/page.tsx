import { notFound } from "next/navigation"
import { getDrawerDataForPost } from "@/lib/content-studio/drawer-data"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"
import { TabContent } from "@/components/admin/content-studio/TabContent"
import type { DrawerTab } from "@/components/admin/content-studio/drawer/DrawerContent"

interface PageProps {
  params: Promise<{ postId: string }>
  searchParams: Promise<{ tab?: string }>
}

function resolveDrawerTab(raw: string | undefined): DrawerTab {
  if (raw === "posts" || raw === "meta" || raw === "transcript") return raw
  return "posts"
}

export default async function ContentStudioPostDrawerPage({ params, searchParams }: PageProps) {
  const { postId } = await params
  const { tab } = await searchParams

  const data = await getDrawerDataForPost(postId)
  if (!data) notFound()

  const defaultTab = resolveDrawerTab(tab)
  const closeHref = "/admin/content?tab=posts"

  return (
    <>
      <TabContent tab="posts" />
      <DetailDrawer data={data} defaultTab={defaultTab} closeHref={closeHref} />
    </>
  )
}
