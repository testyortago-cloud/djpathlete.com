"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Search,
  Sparkles,
} from "lucide-react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Input } from "@/components/ui/input"
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

function hostFromUrl(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return undefined
  }
}

function rankLabel(rank: number | undefined): string {
  if (!rank || rank <= 0) return "—"
  return String(rank).padStart(2, "0")
}

interface TopicCardProps {
  entry: ContentCalendarEntry
  isHero: boolean
  draftBlog: (entry: ContentCalendarEntry) => void
  generatePost: (entry: ContentCalendarEntry) => Promise<void>
}

function TopicCard({ entry, isHero, draftBlog, generatePost }: TopicCardProps) {
  const [expanded, setExpanded] = useState(false)
  const meta = metadataOf(entry)
  const host = hostFromUrl(meta.tavily_url)
  const rank = meta.rank ?? 0
  const label = rankLabel(rank)
  const hasSummary = Boolean(meta.summary)

  return (
    <article
      className={cn(
        "group relative bg-card border border-border/60 transition-colors",
        "hover:border-border",
        isHero
          ? "rounded-xl border-l-[3px] border-l-accent"
          : "rounded-lg",
      )}
    >
      <button
        type="button"
        onClick={() => hasSummary && setExpanded((v) => !v)}
        aria-expanded={hasSummary ? expanded : undefined}
        disabled={!hasSummary}
        className={cn(
          "w-full text-left flex items-start gap-4 transition-colors",
          isHero ? "p-5" : "p-4",
          hasSummary && "hover:bg-surface/30",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "shrink-0 font-mono tabular-nums leading-none select-none mt-0.5",
            isHero
              ? "text-3xl text-primary"
              : rank > 0 && rank <= 3
                ? "text-2xl text-primary/70"
                : "text-2xl text-muted-foreground/50",
          )}
        >
          {label}
        </span>

        <div className="flex-1 min-w-0">
          <h3
            className={cn(
              "font-heading text-primary leading-snug",
              isHero ? "text-lg sm:text-xl" : "text-[15px]",
            )}
          >
            {entry.title}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <span aria-label={`Rank ${label}`}>RANK {label}</span>
            {host && (
              <>
                <span aria-hidden className="text-muted-foreground/40">·</span>
                <span className="truncate max-w-[16rem] normal-case tracking-normal">
                  {host}
                </span>
              </>
            )}
            {hasSummary && (
              <>
                <span aria-hidden className="text-muted-foreground/40">·</span>
                <span className="inline-flex items-center gap-1 text-accent">
                  {expanded ? (
                    <>
                      Hide brief
                      <ChevronDown className="size-3" />
                    </>
                  ) : (
                    <>
                      Read brief
                      <ChevronRight className="size-3" />
                    </>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
      </button>

      {expanded && hasSummary && (
        <div
          className={cn(
            "border-t border-border/40 bg-surface/20",
            isHero ? "px-5 py-4" : "px-4 py-3",
          )}
        >
          <p className="text-sm leading-relaxed text-foreground/85 sm:ml-12">
            {meta.summary}
          </p>
        </div>
      )}

      <div
        className={cn(
          "flex flex-wrap items-center gap-2 border-t border-border/40",
          isHero ? "px-5 py-3" : "px-4 py-2.5",
        )}
      >
        <button
          type="button"
          onClick={() => draftBlog(entry)}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-white hover:bg-primary/90 transition-colors"
        >
          <Sparkles className="size-3.5" />
          Draft blog
        </button>
        <button
          type="button"
          onClick={() => generatePost(entry)}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 transition-colors"
          title="Generate full post + images via AI"
        >
          <Sparkles className="size-3.5" />
          Generate post
        </button>
        {meta.tavily_url && (
          <a
            href={meta.tavily_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline px-2 py-1.5"
          >
            <ExternalLink className="size-3" />
            Open source
          </a>
        )}
      </div>
    </article>
  )
}

export function TopicSuggestionsList({ suggestions }: TopicSuggestionsListProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return suggestions
    return suggestions.filter((s) => {
      const meta = metadataOf(s)
      return (
        s.title.toLowerCase().includes(q) ||
        (meta.summary?.toLowerCase().includes(q) ?? false) ||
        (hostFromUrl(meta.tavily_url)?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [suggestions, search])

  // Group by week, topics ranked asc within a group, weeks newest first
  const groups = useMemo(() => {
    const byDate = new Map<string, ContentCalendarEntry[]>()
    for (const s of filtered) {
      const arr = byDate.get(s.scheduled_for) ?? []
      arr.push(s)
      byDate.set(s.scheduled_for, arr)
    }
    for (const arr of byDate.values()) {
      arr.sort((a, b) => (metadataOf(a).rank ?? 999) - (metadataOf(b).rank ?? 999))
    }
    return Array.from(byDate.entries()).sort(([a], [b]) => (a < b ? 1 : -1))
  }, [filtered])

  function draftBlog(entry: ContentCalendarEntry) {
    const meta = metadataOf(entry)
    const promptLines = [entry.title, meta.summary].filter(Boolean).join("\n\n")
    router.push(`/admin/blog/new?prompt=${encodeURIComponent(promptLines)}`)
  }

  async function generatePost(entry: ContentCalendarEntry) {
    try {
      const res = await fetch("/api/admin/blog/generate-from-suggestion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ calendarId: entry.id }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        alert(`Failed to enqueue: ${json.error ?? res.status}`)
        return
      }
      // Optimistic UX: send admin to the blog list; the post will appear as a draft when generation completes.
      router.push("/admin/blog?just_queued=1")
      router.refresh()
    } catch (err) {
      alert(`Network error: ${(err as Error).message}`)
    }
  }

  if (suggestions.length === 0) {
    return (
      <div className="border border-border rounded-xl bg-surface/40 p-8 text-center text-sm text-muted-foreground">
        No topic suggestions yet. The weekly trending scan runs Monday 6&nbsp;AM UTC.
      </div>
    )
  }

  const totalCount = suggestions.length
  const weekCount = new Set(suggestions.map((s) => s.scheduled_for)).size
  const isSearching = search.trim().length > 0
  const [latestGroup, ...archiveGroups] = groups

  return (
    <div className="space-y-10">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 pb-4 border-b border-border/60">
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search topics, mechanisms, sources…"
            className="pl-8"
            aria-label="Search topic suggestions"
          />
        </div>
        <p className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground shrink-0">
          {totalCount} topic{totalCount === 1 ? "" : "s"} · {weekCount} week
          {weekCount === 1 ? "" : "s"}
        </p>
      </div>

      {isSearching && filtered.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No matches for &ldquo;{search}&rdquo;
        </div>
      )}

      {/* Search-active flat result list */}
      {isSearching && filtered.length > 0 && (
        <section aria-label="Search results">
          <header className="mb-4 flex items-baseline justify-between gap-4">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent">
              ─ Results
            </p>
            <span className="text-[11px] font-mono text-muted-foreground">
              {filtered.length} match{filtered.length === 1 ? "" : "es"}
            </span>
          </header>
          <div className="space-y-3">
            {filtered.map((t) => (
              <TopicCard
                key={t.id}
                entry={t}
                isHero={false}
                draftBlog={draftBlog}
                generatePost={generatePost}
              />
            ))}
          </div>
        </section>
      )}

      {/* Default view: featured latest week */}
      {!isSearching && latestGroup && (
        <section aria-labelledby="latest-week-heading">
          <header className="mb-5">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent">
              ─ This week&rsquo;s brief
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-4">
              <h2
                id="latest-week-heading"
                className="font-heading text-primary text-xl"
              >
                Week of {formatScheduledFor(latestGroup[0])}
              </h2>
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground shrink-0">
                {latestGroup[1].length} topic
                {latestGroup[1].length === 1 ? "" : "s"}
              </span>
            </div>
          </header>

          <div className="space-y-3">
            {latestGroup[1].map((t, idx) => (
              <TopicCard
                key={t.id}
                entry={t}
                isHero={idx === 0}
                draftBlog={draftBlog}
                generatePost={generatePost}
              />
            ))}
          </div>
        </section>
      )}

      {/* Default view: archived weeks (collapsed) */}
      {!isSearching && archiveGroups.length > 0 && (
        <section aria-labelledby="archive-heading">
          <h2
            id="archive-heading"
            className="mb-3 text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground"
          >
            ─ Archive · earlier weeks
          </h2>
          <Accordion type="multiple" className="space-y-2">
            {archiveGroups.map(([date, topics]) => (
              <AccordionItem
                key={date}
                value={date}
                className="border border-border/60 rounded-lg bg-card overflow-hidden"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-surface/40 data-[state=open]:bg-surface/40 data-[state=open]:border-b data-[state=open]:border-border/40 rounded-none">
                  <div className="flex-1 flex items-baseline justify-between gap-4 text-left">
                    <span className="font-heading text-primary text-sm">
                      Week of {formatScheduledFor(date)}
                    </span>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                      {topics.length} topic{topics.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-3">
                  <div className="space-y-3">
                    {topics.map((t) => (
                      <TopicCard
                        key={t.id}
                        entry={t}
                        isHero={false}
                        draftBlog={draftBlog}
                        generatePost={generatePost}
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      )}
    </div>
  )
}
