"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { ExternalLink, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ContentCalendarEntry } from "@/types/database"

interface TopicSuggestionsListProps {
  suggestions: ContentCalendarEntry[]
}

interface TopicMetadata {
  source?: string
  rank?: number
  tavily_url?: string
  summary?: string
}

function formatScheduledFor(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00.000Z")
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function metadataOf(entry: ContentCalendarEntry): TopicMetadata {
  return (entry.metadata ?? {}) as TopicMetadata
}

export function TopicSuggestionsList({ suggestions }: TopicSuggestionsListProps) {
  const router = useRouter()

  // Group by scheduled_for date, sort topics within a group by rank asc
  const groups = useMemo(() => {
    const byDate = new Map<string, ContentCalendarEntry[]>()
    for (const s of suggestions) {
      const arr = byDate.get(s.scheduled_for) ?? []
      arr.push(s)
      byDate.set(s.scheduled_for, arr)
    }
    for (const arr of byDate.values()) {
      arr.sort((a, b) => (metadataOf(a).rank ?? 999) - (metadataOf(b).rank ?? 999))
    }
    return Array.from(byDate.entries()) // entries already in desc date order from DAL
  }, [suggestions])

  function draftBlog(entry: ContentCalendarEntry) {
    const meta = metadataOf(entry)
    const promptLines = [entry.title, meta.summary].filter(Boolean).join("\n\n")
    router.push(`/admin/blog/new?prompt=${encodeURIComponent(promptLines)}`)
  }

  if (suggestions.length === 0) {
    return (
      <div className="border border-border rounded-xl bg-surface/40 p-8 text-center text-sm text-muted-foreground">
        No topic suggestions yet. The weekly trending scan runs Monday 6&nbsp;AM UTC.
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {groups.map(([date, topics]) => (
        <section key={date}>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">
              Week of {formatScheduledFor(date)}
            </h2>
            <span className="text-xs text-muted-foreground">
              {topics.length} {topics.length === 1 ? "topic" : "topics"}
            </span>
          </div>
          <ul className="space-y-2">
            {topics.map((t) => {
              const meta = metadataOf(t)
              return (
                <li
                  key={t.id}
                  className="border border-border rounded-lg bg-card p-4 hover:bg-surface/60 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "shrink-0 size-7 rounded-full flex items-center justify-center",
                        "bg-primary/10 text-primary text-xs font-semibold",
                      )}
                      aria-label={`Rank ${meta.rank ?? "?"}`}
                    >
                      {meta.rank ?? "?"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-primary leading-tight">{t.title}</h3>
                      {meta.summary && (
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-3">{meta.summary}</p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => draftBlog(t)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-white hover:bg-primary/90"
                        >
                          <Sparkles className="size-3.5" />
                          Draft blog
                        </button>
                        {meta.tavily_url && (
                          <a
                            href={meta.tavily_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                          >
                            <ExternalLink className="size-3" />
                            Open source
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
