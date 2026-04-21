import { notFound } from "next/navigation"
import { getDrawerData } from "@/lib/content-studio/drawer-data"
import { getPipelineData } from "@/lib/content-studio/pipeline-data"
import { getCalendarData } from "@/lib/content-studio/calendar-data"
import { computeCalendarWindow } from "@/lib/content-studio/calendar-window"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"
import { PipelineBoard } from "@/components/admin/content-studio/pipeline/PipelineBoard"
import { VideosList } from "@/components/admin/content-studio/list/VideosList"
import { PostsList } from "@/components/admin/content-studio/list/PostsList"
import { CalendarContainer } from "@/components/admin/content-studio/calendar/CalendarContainer"
import type { DrawerTab } from "@/components/admin/content-studio/drawer/DrawerContent"

interface PageProps {
  params: Promise<{ videoId: string }>
  searchParams: Promise<{
    tab?: string
    drawerTab?: string
    postId?: string
    view?: string
    anchor?: string
  }>
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
  const { tab, drawerTab, postId, view, anchor } = await searchParams

  const data = await getDrawerData(videoId)
  if (!data) notFound()

  const effectiveData = postId ? { ...data, highlightPostId: postId } : data

  const shellTab = resolveShellTab(tab)
  const drawerFromOuterTab = shellTab ? undefined : tab
  const defaultDrawerTab = resolveDrawerTab(drawerTab ?? drawerFromOuterTab, postId ? "posts" : "transcript")
  const closeHref = shellTab ? `/admin/content?tab=${shellTab}` : "/admin/content"

  // Fetch pipeline + calendar (if shellTab=calendar) in parallel — both feed the
  // content rendered behind the drawer.
  const win = computeCalendarWindow(view, anchor)
  const [pipeline, calendar] = await Promise.all([
    getPipelineData(),
    shellTab === "calendar" ? getCalendarData(win) : Promise.resolve(null),
  ])

  let underneath: React.ReactNode
  switch (shellTab) {
    case "calendar": {
      underneath = <CalendarContainer data={calendar!} videos={pipeline.videos} />
      break
    }
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
