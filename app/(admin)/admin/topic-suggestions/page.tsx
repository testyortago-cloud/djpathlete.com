import { Lightbulb } from "lucide-react"
import { listTopicSuggestions } from "@/lib/db/content-calendar"
import { getScanTopics } from "@/lib/blog/scan-topics-store"
import { TopicSuggestionsList } from "@/components/admin/topic-suggestions/TopicSuggestionsList"
import { BlogTopicControls } from "@/components/admin/topic-suggestions/BlogTopicControls"
import type { ContentCalendarEntry } from "@/types/database"

export const metadata = { title: "Topic Suggestions" }

export default async function TopicSuggestionsPage() {
  const [suggestions, scanTopics] = await Promise.all([listTopicSuggestions(), getScanTopics()])

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Lightbulb className="size-5 text-primary" />
        <h1 className="text-2xl font-semibold text-primary">Topic Suggestions</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Weekly trending topics pulled from search and ranked for strength &amp; conditioning coaches and sport science / performance practitioners. Choose what the weekly scan searches, add your own topics, then click &quot;Generate draft&quot; on any topic.
      </p>

      <BlogTopicControls initialTopics={scanTopics} />

      <TopicSuggestionsList suggestions={suggestions as ContentCalendarEntry[]} />
    </div>
  )
}
