import { Lightbulb } from "lucide-react"
import { listTopicSuggestions } from "@/lib/db/content-calendar"
import { getSetting } from "@/lib/db/system-settings"
import { BLOG_SCAN_QUERIES_KEY, DEFAULT_BLOG_SCAN_QUERIES } from "@/lib/blog/scan-queries"
import { TopicSuggestionsList } from "@/components/admin/topic-suggestions/TopicSuggestionsList"
import { BlogTopicControls } from "@/components/admin/topic-suggestions/BlogTopicControls"
import type { ContentCalendarEntry } from "@/types/database"

export const metadata = { title: "Topic Suggestions" }

export default async function TopicSuggestionsPage() {
  const [suggestions, scanQueries] = await Promise.all([
    listTopicSuggestions(),
    getSetting<string[]>(BLOG_SCAN_QUERIES_KEY, DEFAULT_BLOG_SCAN_QUERIES),
  ])

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Lightbulb className="size-5 text-primary" />
        <h1 className="text-2xl font-semibold text-primary">Topic Suggestions</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Weekly trending topics pulled from search and ranked for strength &amp; conditioning coaches and sport science / performance practitioners. Add your own topics or steer the weekly scan below, then click &quot;Draft blog&quot; on any topic.
      </p>

      <BlogTopicControls initialQueries={scanQueries} />

      <TopicSuggestionsList suggestions={suggestions as ContentCalendarEntry[]} />
    </div>
  )
}
