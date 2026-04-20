"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, AlertCircle, RefreshCw, ChevronDown, ChevronRight, Search, X } from "lucide-react"
import { toast } from "sonner"
import { useAiJob } from "@/hooks/use-ai-job"

export interface TavilyResearchBrief {
  topic: string
  summary: string | null
  results: Array<{
    title: string
    url: string
    snippet: string
    score: number
    published_date: string | null
  }>
  extracted: Array<{ url: string; content: string }>
  generated_at: string
}

interface ResearchPanelProps {
  blogPostId: string
  postTitle: string
  initialBrief: TavilyResearchBrief | null
  onBriefChange: (brief: TavilyResearchBrief) => void
  /** For tests — normally managed internally */
  activeJobId?: string | null
  /** Close button handler, if rendered as a drawer */
  onClose?: () => void
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function formatRefreshedAt(iso: string): string {
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function ResearchPanel({
  blogPostId,
  postTitle,
  initialBrief,
  onBriefChange,
  activeJobId: activeJobIdProp,
  onClose,
}: ResearchPanelProps) {
  const [jobId, setJobId] = useState<string | null>(activeJobIdProp ?? null)
  const [submitting, setSubmitting] = useState(false)
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null)
  const aiJob = useAiJob(jobId)

  // When parent passes a jobId via prop (e.g. tests), mirror it into state.
  useEffect(() => {
    if (activeJobIdProp !== undefined) setJobId(activeJobIdProp ?? null)
  }, [activeJobIdProp])

  const notifiedJobIdRef = useRef<string | null>(null)

  // When job completes, surface the brief to parent exactly once, then clear
  // the jobId so a subsequent re-run starts fresh (isLoading/isError gates
  // depend on jobId !== null). Ref is keyed on the current jobId so re-runs
  // with a new jobId re-arm the notification.
  useEffect(() => {
    if (
      jobId &&
      aiJob.status === "completed" &&
      aiJob.result &&
      notifiedJobIdRef.current !== jobId
    ) {
      notifiedJobIdRef.current = jobId
      onBriefChange(aiJob.result as unknown as TavilyResearchBrief)
      setJobId(null)
    }
  }, [jobId, aiJob.status, aiJob.result, onBriefChange])

  async function kickOff() {
    const trimmed = postTitle.trim()
    if (!trimmed) {
      toast.error("Add a title before researching")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/blog-posts/${blogPostId}/research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: trimmed }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Research failed (${res.status})`)
      }
      const body = (await res.json()) as { jobId: string }
      setJobId(body.jobId)
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to start research")
    } finally {
      setSubmitting(false)
    }
  }

  // Effective brief: the active job's result takes precedence (newest),
  // otherwise show whatever is saved on the post.
  const brief =
    aiJob.status === "completed" && aiJob.result
      ? (aiJob.result as unknown as TavilyResearchBrief)
      : initialBrief

  const isLoading = submitting || (jobId !== null && (aiJob.status === "pending" || aiJob.status === "processing"))
  const isError = jobId !== null && aiJob.status === "failed"

  return (
    <aside
      className="w-80 shrink-0 border-l border-border bg-surface/50 flex flex-col overflow-hidden"
      aria-label="Research panel"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Search className="size-4" />
          Research
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-primary"
            aria-label="Close research panel"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Error state */}
        {isError && (
          <div className="p-4">
            <div className="flex gap-2 text-error">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <div className="text-sm">{aiJob.error ?? "Research failed"}</div>
            </div>
            <button
              type="button"
              onClick={kickOff}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <RefreshCw className="size-3.5" /> Try again
            </button>
          </div>
        )}

        {/* Loading state */}
        {!isError && isLoading && (
          <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Researching &ldquo;{postTitle.trim() || "…"}&rdquo;
          </div>
        )}

        {/* Empty state */}
        {!isError && !isLoading && !brief && (
          <div className="p-4">
            <p className="text-sm text-muted-foreground mb-3">
              Pull a research brief for this post&apos;s topic — summary + ranked sources in a few seconds.
            </p>
            <button
              type="button"
              onClick={kickOff}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-white hover:bg-primary/90"
            >
              <Search className="size-4" />
              Research this topic
            </button>
          </div>
        )}

        {/* Populated state */}
        {!isError && !isLoading && brief && (
          <div className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                Refreshed {formatRefreshedAt(brief.generated_at)}
              </div>
              <button
                type="button"
                onClick={kickOff}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                title="Re-run research"
              >
                <RefreshCw className="size-3" /> Re-run
              </button>
            </div>

            {brief.summary && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Summary</div>
                <p className="text-sm text-primary leading-relaxed">{brief.summary}</p>
              </div>
            )}

            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Sources ({brief.results.length})
              </div>
              {brief.results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No sources found for &ldquo;{brief.topic}&rdquo; — try a different title or refine.
                </p>
              ) : (
                <ul className="space-y-2">
                  {brief.results.map((r) => {
                    const expanded = expandedUrl === r.url
                    const extract = brief.extracted.find((e) => e.url === r.url)
                    return (
                      <li key={r.url} className="border border-border rounded-md bg-card">
                        <button
                          type="button"
                          onClick={() => setExpandedUrl(expanded ? null : r.url)}
                          className="w-full flex items-start gap-2 px-3 py-2 text-left"
                        >
                          {expanded ? (
                            <ChevronDown className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-primary truncate">{r.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {domainOf(r.url)}
                              {r.published_date ? ` · ${r.published_date}` : ""}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.snippet}</div>
                          </div>
                        </button>
                        {expanded && extract && (
                          <div className="px-3 pb-3 text-xs text-muted-foreground whitespace-pre-wrap max-h-60 overflow-y-auto">
                            {extract.content}
                          </div>
                        )}
                        {expanded && !extract && (
                          <div className="px-3 pb-3 text-xs text-muted-foreground">
                            No extracted content for this source.{" "}
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noreferrer"
                              className="underline text-primary"
                            >
                              Open source ↗
                            </a>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
