import { getPipelineData } from "@/lib/content-studio/pipeline-data"
import { PipelineBoard } from "@/components/admin/content-studio/pipeline/PipelineBoard"
import { VideosList } from "@/components/admin/content-studio/list/VideosList"
import { PostsList } from "@/components/admin/content-studio/list/PostsList"
import { getCalendarData } from "@/lib/content-studio/calendar-data"
import { computeCalendarWindow } from "@/lib/content-studio/calendar-window"
import { CalendarContainer } from "@/components/admin/content-studio/calendar/CalendarContainer"
import { readPreferences } from "@/lib/content-studio/preferences"
import { coerceStoredFilters } from "@/lib/content-studio/pipeline-filters"

interface PageProps {
  searchParams: Promise<{ tab?: string; view?: string; anchor?: string }>
}

type CalendarView = "month" | "week" | "day"
const VALID_VIEWS: readonly CalendarView[] = ["month", "week", "day"] as const

function toCalendarView(raw: string | null | undefined): CalendarView | null {
  return raw && (VALID_VIEWS as readonly string[]).includes(raw) ? (raw as CalendarView) : null
}

export default async function ContentStudioPage({ searchParams }: PageProps) {
  const { tab, view, anchor } = await searchParams
  const prefs = await readPreferences()
  const effectiveView: CalendarView =
    toCalendarView(view) ?? toCalendarView(prefs?.calendar_default_view) ?? "month"

  if (tab === "calendar") {
    const window = computeCalendarWindow(effectiveView, anchor)
    const [calendar, pipeline] = await Promise.all([getCalendarData(window), getPipelineData()])
    return <CalendarContainer data={calendar} videos={pipeline.videos} defaultView={effectiveView} />
  }

  const data = await getPipelineData()
  switch (tab) {
    case "videos":
      return <VideosList videos={data.videos} postCountsByVideo={data.postCountsByVideo} />
    case "posts":
      return <PostsList posts={data.posts} />
    default:
      return (
        <PipelineBoard
          initialData={data}
          initialFilters={coerceStoredFilters(prefs?.last_pipeline_filters) ?? undefined}
        />
      )
  }
}
