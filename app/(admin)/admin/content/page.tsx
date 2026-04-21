import { getPipelineData } from "@/lib/content-studio/pipeline-data"
import { PipelineBoard } from "@/components/admin/content-studio/pipeline/PipelineBoard"
import { VideosList } from "@/components/admin/content-studio/list/VideosList"
import { PostsList } from "@/components/admin/content-studio/list/PostsList"
import { getCalendarData } from "@/lib/content-studio/calendar-data"
import { computeCalendarWindow } from "@/lib/content-studio/calendar-window"
import { CalendarContainer } from "@/components/admin/content-studio/calendar/CalendarContainer"

interface PageProps {
  searchParams: Promise<{ tab?: string; view?: string; anchor?: string }>
}

export default async function ContentStudioPage({ searchParams }: PageProps) {
  const { tab, view, anchor } = await searchParams

  if (tab === "calendar") {
    const window = computeCalendarWindow(view, anchor)
    const [calendar, pipeline] = await Promise.all([getCalendarData(window), getPipelineData()])
    return <CalendarContainer data={calendar} videos={pipeline.videos} />
  }

  const data = await getPipelineData()
  switch (tab) {
    case "videos":
      return <VideosList videos={data.videos} />
    case "posts":
      return <PostsList posts={data.posts} />
    default:
      return <PipelineBoard initialData={data} />
  }
}
