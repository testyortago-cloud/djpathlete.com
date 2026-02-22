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
} from "lucide-react"
import { Button } from "@/components/ui/button"

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

export function AiUsageDashboard() {
  const [data, setData] = useState<AiUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
    stats.total_generations > 0
      ? ((stats.successful / stats.total_generations) * 100).toFixed(1)
      : "0"

  return (
    <div>
      {/* Intro + Refresh */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <p className="text-sm text-muted-foreground max-w-xl">
          Tracks AI-powered features: program generation, Coach DJP suggestions, and exercise swap recommendations. Each AI call uses tokens (like credits) &mdash; costs are estimated from Claude API pricing to help you monitor spending.
        </p>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="shrink-0">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <Brain className="size-4 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground" title="Total number of AI requests across all features">Total Generations</p>
          </div>
          <p className="text-2xl font-semibold text-primary">
            {stats.total_generations}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            All AI calls: programs, coach tips, swaps
          </p>
          {stats.generating > 0 && (
            <p className="text-xs text-warning mt-1">
              {stats.generating} currently generating
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-success/10">
              <CheckCircle className="size-4 text-success" />
            </div>
            <p className="text-sm text-muted-foreground" title="Percentage of AI requests that completed without errors">Success Rate</p>
          </div>
          <p className="text-2xl font-semibold text-primary">{successRate}%</p>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.successful} succeeded, {stats.failed} failed
          </p>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <Coins className="size-4 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground" title="Average tokens (input + output text units) per AI request">Avg Tokens</p>
          </div>
          <p className="text-2xl font-semibold text-primary">
            {formatTokens(stats.avg_tokens_per_generation)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatTokens(stats.total_tokens)} total &middot; measures input + output text
          </p>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <Clock className="size-4 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground" title="Average time for each AI request to complete">Avg Duration</p>
          </div>
          <p className="text-2xl font-semibold text-primary">
            {formatDuration(stats.avg_duration_ms)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Time per AI request from start to finish
          </p>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-accent/20">
              <DollarSign className="size-4 text-accent-foreground" />
            </div>
            <p className="text-sm text-muted-foreground" title="Estimated total cost based on Claude API token pricing">Est. Cost</p>
          </div>
          <p className="text-2xl font-semibold text-primary">
            {estimateCost(stats.total_tokens)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            ~$0.009 / 1K tokens (blended input + output)
          </p>
        </div>
      </div>

      {/* Recent Generations Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Brain className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">
            Recent Generations
          </h2>
        </div>

        {recent_logs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No AI generations yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Date
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Model
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Tokens Used
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Duration
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Error
                  </th>
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
                    <td className="px-4 py-3 text-foreground font-mono text-xs">
                      {log.model_used ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {log.tokens_used != null
                        ? formatTokens(log.tokens_used)
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {formatDuration(log.duration_ms)}
                    </td>
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
  )
}
