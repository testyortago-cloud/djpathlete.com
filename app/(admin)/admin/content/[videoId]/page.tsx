import { notFound } from "next/navigation"
import { getDrawerData } from "@/lib/content-studio/drawer-data"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"
import { TabContent } from "@/components/admin/content-studio/TabContent"
import type { DrawerTab } from "@/components/admin/content-studio/drawer/DrawerContent"

interface PageProps {
  params: Promise<{ videoId: string }>
  searchParams: Promise<{ tab?: string; drawerTab?: string; postId?: string }>
}

function resolveDrawerTab(raw: string | undefined, fallback: DrawerTab): DrawerTab {
  if (raw === "posts" || raw === "meta" || raw === "transcript") return raw
  return fallback
}

// The outer ?tab= param drives shell tab state (pipeline/calendar/videos/posts)
// and is preserved across drawer interactions so ESC / close can return the
// user to the tab they came from. Drawer-internal tab state lives in
// ?drawerTab= so it never corrupts ?tab=. For backwards-compatible deep links
// we still accept ?tab=transcript|posts|meta as a drawer value when ?tab= is
// not a shell value.
function resolveShellTab(raw: string | undefined): string | undefined {
  if (raw === "pipeline" || raw === "calendar" || raw === "videos" || raw === "posts") return raw
  return undefined
}

export default async function ContentStudioDrawerPage({ params, searchParams }: PageProps) {
  const { videoId } = await params
  const { tab, drawerTab, postId } = await searchParams

  const data = await getDrawerData(videoId)
  if (!data) notFound()

  const effectiveData = postId ? { ...data, highlightPostId: postId } : data

  // Default tab selection follows the spec:
  //   video card → transcript
  //   post card (postId present) → posts
  // ?drawerTab= wins, then a drawer-valued ?tab= (deep-link), then the card
  // source default.
  const shellTab = resolveShellTab(tab)
  const drawerFromOuterTab = shellTab ? undefined : tab
  const defaultTab = resolveDrawerTab(drawerTab ?? drawerFromOuterTab, postId ? "posts" : "transcript")

  const closeHref = shellTab ? `/admin/content?tab=${shellTab}` : "/admin/content"

  return (
    <>
      <TabContent tab={shellTab} />
      <DetailDrawer data={effectiveData} defaultTab={defaultTab} closeHref={closeHref} />
    </>
  )
}
