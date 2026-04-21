import { notFound } from "next/navigation"
import { getDrawerDataForPost } from "@/lib/content-studio/drawer-data"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"
import { TabContent } from "@/components/admin/content-studio/TabContent"
import type { DrawerTab } from "@/components/admin/content-studio/drawer/DrawerContent"

interface PageProps {
  params: Promise<{ postId: string }>
  searchParams: Promise<{ tab?: string; drawerTab?: string }>
}

function resolveDrawerTab(raw: string | undefined): DrawerTab | null {
  if (raw === "posts" || raw === "meta" || raw === "transcript") return raw
  return null
}

export default async function ContentStudioPostDrawerPage({ params, searchParams }: PageProps) {
  const { postId } = await params
  const { tab, drawerTab } = await searchParams

  const data = await getDrawerDataForPost(postId)
  if (!data) notFound()

  // Prefer ?drawerTab=, then legacy ?tab= (when it matches a drawer tab),
  // otherwise land on Posts since we entered from a post card.
  const defaultTab: DrawerTab = resolveDrawerTab(drawerTab) ?? resolveDrawerTab(tab) ?? "posts"
  const closeHref = "/admin/content?tab=posts"

  return (
    <>
      <TabContent tab="posts" />
      <DetailDrawer data={data} defaultTab={defaultTab} closeHref={closeHref} />
    </>
  )
}
