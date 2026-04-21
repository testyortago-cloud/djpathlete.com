import { notFound } from "next/navigation"
import { getDrawerData } from "@/lib/content-studio/drawer-data"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"
import { TabContent } from "@/components/admin/content-studio/TabContent"
import type { DrawerTab } from "@/components/admin/content-studio/drawer/DrawerContent"

interface PageProps {
  params: Promise<{ videoId: string }>
  searchParams: Promise<{ tab?: string; postId?: string }>
}

function resolveDrawerTab(raw: string | undefined, fallback: DrawerTab): DrawerTab {
  if (raw === "posts" || raw === "meta" || raw === "transcript") return raw
  return fallback
}

// The outer ?tab= param is shared between the shell tabs (pipeline/calendar/
// videos/posts) and the drawer tabs (transcript/posts/meta). The drawer tabs
// are a subset of values, so we route the shell-tab values through TabContent
// and only interpret drawer-specific tabs for the drawer.
function resolveShellTab(raw: string | undefined): string | undefined {
  if (raw === "pipeline" || raw === "calendar" || raw === "videos" || raw === "posts") return raw
  return undefined
}

export default async function ContentStudioDrawerPage({ params, searchParams }: PageProps) {
  const { videoId } = await params
  const { tab, postId } = await searchParams

  const data = await getDrawerData(videoId)
  if (!data) notFound()

  const effectiveData = postId ? { ...data, highlightPostId: postId } : data

  // Default tab selection follows the spec:
  //   video card → transcript
  //   post card (postId present) → posts
  // A drawer-specific ?tab= value wins.
  const defaultTab = resolveDrawerTab(tab, postId ? "posts" : "transcript")

  const shellTab = resolveShellTab(tab)
  const closeHref = shellTab ? `/admin/content?tab=${shellTab}` : "/admin/content"

  return (
    <>
      <TabContent tab={shellTab} />
      <DetailDrawer data={effectiveData} defaultTab={defaultTab} closeHref={closeHref} />
    </>
  )
}
