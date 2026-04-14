"use client"

import { useState, useEffect } from "react"
import { Sparkles, Clock, Coins, CheckCircle, AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface BlogGeneration {
  id: string
  status: string
  input_params: {
    feature: string
    prompt?: string
    tone?: string
    length?: string
    research_papers?: number
    research_source?: string
    user_refs_urls?: number
    user_refs_url_list?: string[]
    user_refs_has_notes?: boolean
    user_refs_notes_excerpt?: string
    user_refs_files?: number
    user_refs_file_names?: string[]
  }
  output_summary: string | null
  error_message: string | null
  model_used: string | null
  tokens_used: number | null
  duration_ms: number | null
  created_at: string
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const TONE_LABELS: Record<string, string> = {
  professional: "Professional",
  conversational: "Conversational",
  motivational: "Motivational",
}

const LENGTH_LABELS: Record<string, string> = {
  short: "Short (~500 words)",
  medium: "Medium (~1,000 words)",
  long: "Long (~1,500 words)",
}

function GenerationCard({ gen }: { gen: BlogGeneration }) {
  const [expanded, setExpanded] = useState(false)
  const params = gen.input_params
  const title = typeof gen.output_summary === "string" ? gen.output_summary.replace(/^Generated blog:\s*/i, "") : null
  const isSuccess = gen.status === "completed"

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-surface/30 transition-colors"
      >
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg mt-0.5",
            isSuccess ? "bg-success/10" : "bg-destructive/10",
          )}
        >
          {isSuccess ? (
            <CheckCircle className="size-4 text-success" />
          ) : (
            <AlertTriangle className="size-4 text-destructive" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground line-clamp-1">
            {title ?? params.prompt?.slice(0, 80) ?? "Blog generation"}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
            <span className="text-xs text-muted-foreground">{formatDate(gen.created_at)}</span>
            {params.tone && (
              <span className="text-xs text-muted-foreground">{TONE_LABELS[params.tone] ?? params.tone}</span>
            )}
            {params.length && (
              <span className="text-xs text-muted-foreground">
                {LENGTH_LABELS[params.length]?.split(" ")[0] ?? params.length}
              </span>
            )}
            {gen.duration_ms != null && (
              <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                <Clock className="size-3" />
                {formatDuration(gen.duration_ms)}
              </span>
            )}
            {gen.tokens_used != null && (
              <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                <Coins className="size-3" />
                {gen.tokens_used.toLocaleString()} tokens
              </span>
            )}
          </div>
        </div>

        {expanded ? (
          <ChevronUp className="size-4 text-muted-foreground shrink-0 mt-1" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground shrink-0 mt-1" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
          {/* Prompt */}
          {params.prompt && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Prompt</p>
              <p className="text-sm text-foreground bg-surface/50 rounded-lg p-3">{params.prompt}</p>
            </div>
          )}

          {/* Generated title */}
          {title && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Generated Title</p>
              <p className="text-sm text-foreground font-medium">{title}</p>
            </div>
          )}

          {/* Settings grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Tone</p>
              <p className="text-sm font-medium">{params.tone ? (TONE_LABELS[params.tone] ?? params.tone) : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Length</p>
              <p className="text-sm font-medium">
                {params.length ? (LENGTH_LABELS[params.length] ?? params.length) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Model</p>
              <p className="text-sm font-medium font-mono">{gen.model_used?.split("-").slice(-1)[0] ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p className={cn("text-sm font-medium capitalize", isSuccess ? "text-success" : "text-destructive")}>
                {gen.status}
              </p>
            </div>
          </div>

          {/* References used */}
          {(params.research_papers ||
            params.user_refs_urls ||
            params.user_refs_url_list?.length ||
            params.user_refs_has_notes ||
            params.user_refs_files) && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">References Used</p>
              <div className="space-y-2">
                {/* URLs */}
                {((params.user_refs_url_list?.length ?? 0) > 0 || (params.user_refs_urls ?? 0) > 0) && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      Links ({params.user_refs_url_list?.length ?? params.user_refs_urls})
                    </p>
                    {params.user_refs_url_list && params.user_refs_url_list.length > 0 ? (
                      <div className="space-y-1">
                        {params.user_refs_url_list.map((url, idx) => (
                          <a
                            key={idx}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline truncate"
                          >
                            <span className="size-1.5 rounded-full bg-primary/40 shrink-0" />
                            {url}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {params.user_refs_urls} URL{params.user_refs_urls !== 1 ? "s" : ""} crawled
                      </p>
                    )}
                  </div>
                )}

                {/* Notes */}
                {params.user_refs_has_notes && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                    {params.user_refs_notes_excerpt ? (
                      <p className="text-xs text-muted-foreground bg-surface/50 rounded-md p-2">
                        {params.user_refs_notes_excerpt}
                        {params.user_refs_notes_excerpt.length >= 200 && "..."}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Notes provided</p>
                    )}
                  </div>
                )}

                {/* Files */}
                {(params.user_refs_files ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      Documents ({params.user_refs_files})
                    </p>
                    {params.user_refs_file_names && params.user_refs_file_names.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {params.user_refs_file_names.map((name, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-xs text-primary"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {params.user_refs_files} file{params.user_refs_files !== 1 ? "s" : ""} uploaded
                      </p>
                    )}
                  </div>
                )}

                {/* Auto-research */}
                {(params.research_papers ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      Auto-Research
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {params.research_papers} paper{params.research_papers !== 1 ? "s" : ""} found
                      {params.research_source ? ` via ${params.research_source}` : ""}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {gen.error_message && (
            <div>
              <p className="text-xs font-medium text-destructive mb-1">Error</p>
              <p className="text-sm text-destructive bg-destructive/5 rounded-lg p-3">{gen.error_message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function BlogGenerationHistory() {
  const [generations, setGenerations] = useState<BlogGeneration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/blog/generations")
      if (!res.ok) throw new Error("Failed to fetch")
      const json = await res.json()
      setGenerations(json.generations ?? [])
    } catch {
      setError("Failed to load generation history.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground text-sm">Loading generation history...</div>
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-destructive mb-2">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </div>
    )
  }

  if (generations.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 mx-auto mb-3">
          <Sparkles className="size-5 text-primary" />
        </div>
        <p className="text-sm text-muted-foreground">No AI-generated blog posts yet.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Use &quot;Generate with AI&quot; when creating a new post to start tracking.
        </p>
      </div>
    )
  }

  const successful = generations.filter((g) => g.status === "completed").length
  const failed = generations.filter((g) => g.status === "failed").length

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {generations.length} generation{generations.length !== 1 ? "s" : ""}{" "}
          <span className="text-success">({successful} successful</span>
          {failed > 0 && <span className="text-destructive">, {failed} failed</span>}
          <span className="text-success">)</span>
        </p>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="space-y-3">
        {generations.map((gen) => (
          <GenerationCard key={gen.id} gen={gen} />
        ))}
      </div>
    </div>
  )
}
