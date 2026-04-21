import { notFound } from "next/navigation"
import { getDrawerDataForPost } from "@/lib/content-studio/drawer-data"
import { getPipelineData } from "@/lib/content-studio/pipeline-data"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"
import { PostsList } from "@/components/admin/content-studio/list/PostsList"
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

  const pipeline = await getPipelineData()

  const defaultTab: DrawerTab =
    resolveDrawerTab(drawerTab) ?? resolveDrawerTab(tab) ?? "posts"
  const closeHref = "/admin/content?tab=posts"

  return (
    <>
      <PostsList posts={pipeline.posts} />
      <DetailDrawer data={data} defaultTab={defaultTab} closeHref={closeHref} />
    </>
  )
}
