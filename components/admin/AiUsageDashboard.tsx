"use client"

import { useEffect, useState, useCallback } from "react"
import {
  Brain,
  CheckCircle,
  Coins,
  Clock,
  DollarSign,
  RefreshCw,
  AlertTriangle,
  Loader2,
  HelpCircle,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface AiStats {
  total_generations: number
  successful: number
  failed: number
  generating: number
  total_tokens: number
  avg_tokens_per_generation: number
  avg_duration_ms: number
}

interface AiLog {
  id: string
  program_id: string | null
  client_id: string | null
  requested_by: string
  status: "pending" | "generating" | "completed" | "failed"
  input_params: object
  output_summary: object | null
  error_message: string | null
  model_used: string | null
  tokens_used: number | null
  duration_ms: number | null
  created_at: string
  completed_at: string | null
}

interface AiUsageResponse {
  stats: AiStats
  recent_logs: AiLog[]
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
  generating: "bg-warning/10 text-warning",
  pending: "bg-muted text-muted-foreground",
}

const METRIC_TOOLTIPS = {
  generations: "Total AI requests across all features — program creation, exercise swaps, coach suggestions, etc.",
  successRate:
    "Percentage of AI requests that completed without errors. A low rate may indicate prompt issues or API outages.",
  avgTokens:
    "Average tokens consumed per request. Tokens are units of text the AI reads and writes — more complex requests use more tokens and cost more.",
  avgDuration: "Average time each AI request takes. Longer times may mean complex prompts or API load.",
  estCost:
    "Estimated spend based on ~$0.009 per 1K tokens (blended input/output rate). Check your Anthropic dashboard for exact billing.",
}

function formatTokens(tokens: number): string {
  return tokens.toLocaleString("en-US")
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-"
  return `${(ms / 1000).toFixed(1)}s`
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

function estimateCost(totalTokens: number): string {
  // Approximate blended rate: ~$0.009 per 1K tokens
  // (average of $0.003/1K input and $0.015/1K output)
  const cost = (totalTokens / 1000) * 0.009
  return `$${cost.toFixed(4)}`
}

function MetricLabel({ children, tooltip }: { children: React.ReactNode; tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-xs sm:text-sm text-muted-foreground inline-flex items-center gap-1 cursor-help">
          {children}
          <HelpCircle className="size-3 text-muted-foreground/50" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px]">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

export function AiUsageDashboard() {
  const [data, setData] = useState<AiUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem("djp-ai-usage-guide-dismissed") !== "true"
  })

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/ai/usage")
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status}`)
      }
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load AI usage data.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  function dismissGuide() {
    setShowGuide(false)
    localStorage.setItem("djp-ai-usage-guide-dismissed", "true")
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 text-primary animate-spin" />
        <span className="ml-2 text-sm text-muted-foreground">Loading AI usage data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <AlertTriangle className="size-8 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </div>
    )
  }

  if (!data) return null

  const { stats, recent_logs } = data
  const successRate =
    stats.total_generations > 0 ? ((stats.successful / stats.total_generations) * 100).toFixed(1) : "0"

  return (
    <TooltipProvider>
      <div>
        {/* Guide Banner */}
        {showGuide && (
          <div className="bg-white rounded-xl border border-border shadow-sm mb-6 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-primary/5">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
                  <HelpCircle className="size-3.5 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-primary">How to read this dashboard</h3>
              </div>
              <button
                onClick={dismissGuide}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
                aria-label="Dismiss guide"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                This page tracks every AI call made on the platform — from program generation to Coach DJP suggestions.
                Each call uses <strong className="text-foreground">tokens</strong> (units of text the AI reads and
                writes), and costs are estimated from Claude API pricing to help you monitor spending.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  {
                    icon: Brain,
                    label: "Generations",
                    desc: "Total AI requests made. Each program created or coach suggestion counts as one generation.",
                    color: "bg-primary/10 text-primary",
                  },
                  {
                    icon: CheckCircle,
                    label: "Success Rate",
                    desc: "How often requests complete without errors. Below 90% may need investigation.",
                    color: "bg-success/10 text-success",
                  },
                  {
                    icon: Coins,
                    label: "Avg Tokens",
                    desc: "Average tokens per request. More complex programs use more tokens and cost more.",
                    color: "bg-primary/10 text-primary",
                  },
                  {
                    icon: Clock,
                    label: "Avg Duration",
                    desc: "How long each request takes. Longer times may mean complex prompts or API load.",
                    color: "bg-primary/10 text-primary",
                  },
                  {
                    icon: DollarSign,
                    label: "Est. Cost",
                    desc: "Approximate total spend based on token usage. Check Anthropic dashboard for exact billing.",
                    color: "bg-accent/20 text-accent",
                  },
                ].map((item) => (
                  <div key={item.label} className="flex gap-3 p-3 rounded-lg bg-surface/50">
                    <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${item.color}`}>
                      <item.icon className="size-3.5" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">Status guide:</strong>{" "}
                  <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-success/10 text-success mx-0.5">
                    Completed
                  </span>{" "}
                  finished successfully,{" "}
                  <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-destructive/10 text-destructive mx-0.5">
                    Failed
                  </span>{" "}
                  hit an error,{" "}
                  <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-warning/10 text-warning mx-0.5">
                    Generating
                  </span>{" "}
                  in progress,{" "}
                  <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground mx-0.5">
                    Pending
                  </span>{" "}
                  queued.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Refresh bar */}
        <div className="flex items-center justify-between mb-4">
          {!showGuide && (
            <button
              onClick={() => setShowGuide(true)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <HelpCircle className="size-3.5" />
              Show guide
            </button>
          )}
          <div className={!showGuide ? "ml-auto" : ""}>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="shrink-0">
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-8">
          <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
              <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-primary/10">
                <Brain className="size-3.5 sm:size-4 text-primary" />
              </div>
              <MetricLabel tooltip={METRIC_TOOLTIPS.generations}>Generations</MetricLabel>
            </div>
            <p className="text-xl sm:text-2xl font-semibold text-primary">{stats.total_generations}</p>
            {stats.generating > 0 && <p className="text-xs text-warning mt-0.5">{stats.generating} active</p>}
          </div>

          <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
              <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-success/10">
                <CheckCircle className="size-3.5 sm:size-4 text-success" />
              </div>
              <MetricLabel tooltip={METRIC_TOOLTIPS.successRate}>Success Rate</MetricLabel>
            </div>
            <p className="text-xl sm:text-2xl font-semibold text-primary">{successRate}%</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              {stats.successful} ok, {stats.failed} failed
            </p>
          </div>

          <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
              <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-primary/10">
                <Coins className="size-3.5 sm:size-4 text-primary" />
              </div>
              <MetricLabel tooltip={METRIC_TOOLTIPS.avgTokens}>Avg Tokens</MetricLabel>
            </div>
            <p className="text-xl sm:text-2xl font-semibold text-primary">
              {formatTokens(stats.avg_tokens_per_generation)}
            </p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              {formatTokens(stats.total_tokens)} total
            </p>
          </div>

          <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
              <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-primary/10">
                <Clock className="size-3.5 sm:size-4 text-primary" />
              </div>
              <MetricLabel tooltip={METRIC_TOOLTIPS.avgDuration}>Avg Duration</MetricLabel>
            </div>
            <p className="text-xl sm:text-2xl font-semibold text-primary">{formatDuration(stats.avg_duration_ms)}</p>
          </div>

          <div className="bg-white rounded-xl border border-border p-3 sm:p-4 col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
              <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-accent/20">
                <DollarSign className="size-3.5 sm:size-4 text-accent" />
              </div>
              <MetricLabel tooltip={METRIC_TOOLTIPS.estCost}>Est. Cost</MetricLabel>
            </div>
            <p className="text-xl sm:text-2xl font-semibold text-primary">{estimateCost(stats.total_tokens)}</p>
          </div>
        </div>

        {/* Recent Generations Table */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <Brain className="size-4 text-primary" />
            <h2 className="text-lg font-semibold text-primary">Recent Generations</h2>
          </div>

          {recent_logs.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No AI generations yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Model</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Tokens Used</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Duration</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {recent_logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[log.status] ?? "bg-muted text-muted-foreground"}`}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground font-mono text-xs">{log.model_used ?? "-"}</td>
                      <td className="px-4 py-3 text-foreground">
                        {log.tokens_used != null ? formatTokens(log.tokens_used) : "-"}
                      </td>
                      <td className="px-4 py-3 text-foreground">{formatDuration(log.duration_ms)}</td>
                      <td className="px-4 py-3 text-destructive text-xs max-w-[200px] truncate">
                        {log.error_message ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
