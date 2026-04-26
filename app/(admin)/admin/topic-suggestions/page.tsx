import { Lightbulb } from "lucide-react"
import { listTopicSuggestions } from "@/lib/db/content-calendar"
import { TopicSuggestionsList } from "@/components/admin/topic-suggestions/TopicSuggestionsList"
import type { ContentCalendarEntry } from "@/types/database"

export const metadata = { title: "Topic Suggestions" }

export default async function TopicSuggestionsPage() {
  const suggestions: ContentCalendarEntry[] = await listTopicSuggestions()

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Lightbulb className="size-5 text-primary" />
        <h1 className="text-2xl font-semibold text-primary">Topic Suggestions</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Weekly trending topics pulled from Tavily search and ranked for strength &amp; conditioning coaches and sport science / performance practitioners. Click &quot;Draft blog&quot; to start a post pre-filled with the topic.
      </p>

      <TopicSuggestionsList suggestions={suggestions} />
    </div>
  )
}
