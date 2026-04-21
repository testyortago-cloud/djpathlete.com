import { notFound } from "next/navigation"
import { getDrawerData } from "@/lib/content-studio/drawer-data"
import { getPipelineData } from "@/lib/content-studio/pipeline-data"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"
import { PipelineBoard } from "@/components/admin/content-studio/pipeline/PipelineBoard"
import { VideosList } from "@/components/admin/content-studio/list/VideosList"
import { PostsList } from "@/components/admin/content-studio/list/PostsList"
import { TabPlaceholder } from "@/components/admin/content-studio/TabPlaceholder"
import type { DrawerTab } from "@/components/admin/content-studio/drawer/DrawerContent"

interface PageProps {
  params: Promise<{ videoId: string }>
  searchParams: Promise<{ tab?: string; drawerTab?: string; postId?: string }>
}

function resolveDrawerTab(raw: string | undefined, fallback: DrawerTab): DrawerTab {
  if (raw === "posts" || raw === "meta" || raw === "transcript") return raw
  return fallback
}

function resolveShellTab(raw: string | undefined): string | undefined {
  if (raw === "pipeline" || raw === "calendar" || raw === "videos" || raw === "posts") return raw
  return undefined
}

export default async function ContentStudioDrawerPage({ params, searchParams }: PageProps) {
  const { videoId } = await params
  const { tab, drawerTab, postId } = await searchParams

  const data = await getDrawerData(videoId)
  if (!data) notFound()

  // Pipeline data is only needed for the tab rendered behind the drawer.
  // Phase 5 may hoist this into the shell layout so it's cached across
  // drawer opens.
  const pipeline = await getPipelineData()

  const effectiveData = postId ? { ...data, highlightPostId: postId } : data

  const shellTab = resolveShellTab(tab)
  const drawerFromOuterTab = shellTab ? undefined : tab
  const defaultDrawerTab = resolveDrawerTab(
    drawerTab ?? drawerFromOuterTab,
    postId ? "posts" : "transcript",
  )
  const closeHref = shellTab ? `/admin/content?tab=${shellTab}` : "/admin/content"

  let underneath: React.ReactNode
  switch (shellTab) {
    case "calendar":
      underneath = <TabPlaceholder tabName="Calendar" phaseLabel="Phase 4" />
      break
    case "videos":
      underneath = <VideosList videos={pipeline.videos} />
      break
    case "posts":
      underneath = <PostsList posts={pipeline.posts} />
      break
    default:
      underneath = <PipelineBoard initialData={pipeline} />
  }

  return (
    <>
      {underneath}
      <DetailDrawer data={effectiveData} defaultTab={defaultDrawerTab} closeHref={closeHref} />
    </>
  )
}
