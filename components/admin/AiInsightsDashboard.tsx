"use client"

import { useState, useEffect } from "react"
import { MessageSquare, Star, Target, TrendingUp, ThumbsUp, ThumbsDown, RefreshCw, HelpCircle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { VoiceDriftCard } from "./ai-insights/VoiceDriftCard"

interface InsightsData {
  overview: {
    total_conversations: number
    total_feedback: number
    avg_accuracy: number | null
    avg_relevance: number | null
    avg_helpfulness: number | null
    thumbs_up_count: number
    thumbs_down_count: number
  }
  feedback_trends: {
    week: string
    avg_accuracy: number | null
    avg_relevance: number | null
    avg_helpfulness: number | null
    count: number
  }[]
  outcomes: {
    total_predictions: number
    resolved_count: number
    avg_accuracy: number | null
    positive_count: number
    negative_count: number
  }
  weight_accuracy: {
    total: number
    resolved: number
    avg_accuracy: number | null
    within_5pct: number
    within_10pct: number
  }
}

const METRIC_TOOLTIPS = {
  conversations:
    "Number of AI chat sessions across all features (Coach DJP, program generation, etc.). Higher numbers mean clients are actively using AI tools.",
  feedback: "How many times users rated an AI response. The percentage shows thumbs-up vs total — aim for above 80%.",
  predictions:
    'AI predictions like weight suggestions. "Resolved" means it was later compared to what actually happened.',
  outcomeAccuracy:
    "How often AI predictions were correct once resolved. Higher is better — this directly reflects AI quality.",
  accuracy: "How factually correct and precise the AI response was.",
  relevance: "How well the response addressed the specific question or context.",
  helpfulness: "How useful the response was for making a decision or taking action.",
  avgWeightAccuracy: "Overall accuracy of weight suggestions compared to actual weights used by the client.",
  within5: "Percentage of predictions within 5% of the actual weight — the gold standard for accuracy.",
  within10: "Percentage within 10% of actual weight — still considered a good prediction.",
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

function StatCard({
  icon: Icon,
  label,
  value,
  subtitle,
  iconColor,
  tooltip,
}: {
  icon: React.ElementType
  label: string
  value: string
  subtitle?: string
  iconColor?: string
  tooltip?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
      <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
        <div
          className={cn(
            "size-8 sm:size-9 rounded-lg flex items-center justify-center",
            iconColor ?? "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-4" />
        </div>
        {tooltip ? (
          <MetricLabel tooltip={tooltip}>{label}</MetricLabel>
        ) : (
          <span className="text-xs sm:text-sm text-muted-foreground">{label}</span>
        )}
      </div>
      <p className="text-xl sm:text-2xl font-semibold">{value}</p>
      {subtitle && <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  )
}

function RatingBar({
  label,
  value,
  maxValue = 5,
  tooltip,
}: {
  label: string
  value: number | null
  maxValue?: number
  tooltip?: string
}) {
  const pct = value ? (value / maxValue) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-sm text-muted-foreground w-28 inline-flex items-center gap-1 cursor-help">
              {label}
              <HelpCircle className="size-3 text-muted-foreground/50" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[220px]">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="text-sm text-muted-foreground w-28">{label}</span>
      )}
      <div className="flex-1 bg-muted rounded-full h-2">
        <div className="bg-accent rounded-full h-2 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-medium w-12 text-right">{value ? value.toFixed(1) : "—"}/5</span>
    </div>
  )
}

export function AiInsightsDashboard() {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem("djp-ai-insights-guide-dismissed") !== "true"
  })

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/ai/insights")
      if (!res.ok) throw new Error("Failed to fetch insights")
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  function dismissGuide() {
    setShowGuide(false)
    localStorage.setItem("djp-ai-insights-guide-dismissed", "true")
  }

  if (loading && !data) {
    return <div className="text-center py-12 text-muted-foreground">Loading AI insights...</div>
  }

  if (error && !data) {
    return (
      <div className="text-center py-12 text-error">
        {error}
        <Button variant="outline" size="sm" className="ml-3" onClick={fetchData}>
          Retry
        </Button>
      </div>
    )
  }

  if (!data) return null

  const thumbsTotal = data.overview.thumbs_up_count + data.overview.thumbs_down_count
  const thumbsUpPct = thumbsTotal > 0 ? Math.round((data.overview.thumbs_up_count / thumbsTotal) * 100) : 0

  const outcomePct =
    data.outcomes.resolved_count > 0
      ? Math.round((data.outcomes.positive_count / data.outcomes.resolved_count) * 100)
      : null

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Guide Banner */}
        {showGuide && (
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
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
                This page measures how well the AI is serving your clients. Use it to track quality over time and catch
                issues early — a drop in ratings or accuracy could mean a prompt needs tuning.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    icon: MessageSquare,
                    label: "Conversations",
                    desc: "Total AI chat sessions. More conversations = more client engagement with AI features.",
                    color: "bg-primary/10 text-primary",
                  },
                  {
                    icon: Star,
                    label: "Feedback Ratings",
                    desc: "Users rate AI responses on accuracy, relevance, and helpfulness (1-5 scale). Aim for 4+ across all three.",
                    color: "bg-amber-100 text-amber-600",
                  },
                  {
                    icon: Target,
                    label: "Predictions & Outcomes",
                    desc: 'Tracks AI predictions (like weight suggestions) against actual results. "Resolved" means verified against real data.',
                    color: "bg-blue-100 text-blue-600",
                  },
                  {
                    icon: TrendingUp,
                    label: "Weight Accuracy",
                    desc: "How close weight suggestions are to what clients actually use. Within 5% is excellent, within 10% is good.",
                    color: "bg-green-100 text-green-600",
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

              <div className="flex items-start gap-2 pt-2 border-t border-border">
                <ThumbsUp className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">Tip:</strong> The weekly feedback trends table at the bottom shows
                  how ratings change over time. A sudden drop may indicate a prompt or model change that needs
                  attention.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Refresh bar */}
        <div className="flex items-center justify-between">
          {!showGuide ? (
            <button
              onClick={() => setShowGuide(true)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <HelpCircle className="size-3.5" />
              Show guide
            </button>
          ) : (
            <div />
          )}
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={fetchData} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={MessageSquare}
            label="Total Conversations"
            value={data.overview.total_conversations.toLocaleString()}
            subtitle="Across all AI features"
            tooltip={METRIC_TOOLTIPS.conversations}
          />
          <StatCard
            icon={Star}
            label="Feedback Received"
            value={data.overview.total_feedback.toLocaleString()}
            subtitle={thumbsTotal > 0 ? `${thumbsUpPct}% positive (thumbs)` : "No thumbs ratings yet"}
            iconColor="bg-amber-100 text-amber-600"
            tooltip={METRIC_TOOLTIPS.feedback}
          />
          <StatCard
            icon={Target}
            label="Predictions Made"
            value={data.outcomes.total_predictions.toLocaleString()}
            subtitle={`${data.outcomes.resolved_count} resolved`}
            iconColor="bg-blue-100 text-blue-600"
            tooltip={METRIC_TOOLTIPS.predictions}
          />
          <StatCard
            icon={TrendingUp}
            label="Outcome Accuracy"
            value={data.outcomes.avg_accuracy ? `${(data.outcomes.avg_accuracy * 100).toFixed(0)}%` : "—"}
            subtitle={outcomePct ? `${outcomePct}% positive outcomes` : "No resolved outcomes yet"}
            iconColor="bg-green-100 text-green-600"
            tooltip={METRIC_TOOLTIPS.outcomeAccuracy}
          />
        </div>

        {/* Feedback Ratings + Weight Accuracy */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Average Ratings */}
          <div className="bg-white rounded-xl border border-border">
            <div className="p-4 border-b border-border">
              <h3 className="font-medium">Average Feedback Ratings</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Hover each rating for a description</p>
            </div>
            <div className="p-4 space-y-3">
              <RatingBar label="Accuracy" value={data.overview.avg_accuracy} tooltip={METRIC_TOOLTIPS.accuracy} />
              <RatingBar label="Relevance" value={data.overview.avg_relevance} tooltip={METRIC_TOOLTIPS.relevance} />
              <RatingBar
                label="Helpfulness"
                value={data.overview.avg_helpfulness}
                tooltip={METRIC_TOOLTIPS.helpfulness}
              />

              {thumbsTotal > 0 && (
                <div className="flex items-center gap-3 pt-2 border-t border-border">
                  <span className="text-sm text-muted-foreground w-28">Client Thumbs</span>
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1 text-sm text-green-600">
                      <ThumbsUp className="size-3.5" />
                      {data.overview.thumbs_up_count}
                    </span>
                    <span className="flex items-center gap-1 text-sm text-red-500">
                      <ThumbsDown className="size-3.5" />
                      {data.overview.thumbs_down_count}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Weight Prediction Accuracy */}
          <div className="bg-white rounded-xl border border-border">
            <div className="p-4 border-b border-border">
              <h3 className="font-medium">Weight Prediction Accuracy</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                How close AI weight suggestions are to actual weights used
              </p>
            </div>
            <div className="p-4">
              {data.weight_accuracy.total === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No weight predictions yet. Use the AI Coach to start tracking.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="cursor-help">
                          <p className="text-2xl font-semibold">
                            {data.weight_accuracy.avg_accuracy
                              ? `${(data.weight_accuracy.avg_accuracy * 100).toFixed(0)}%`
                              : "—"}
                          </p>
                          <p className="text-xs text-muted-foreground inline-flex items-center gap-0.5">
                            Avg Accuracy
                            <HelpCircle className="size-2.5 text-muted-foreground/50" />
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[200px]">{METRIC_TOOLTIPS.avgWeightAccuracy}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="cursor-help">
                          <p className="text-2xl font-semibold">
                            {data.weight_accuracy.resolved > 0
                              ? `${Math.round((data.weight_accuracy.within_5pct / data.weight_accuracy.resolved) * 100)}%`
                              : "—"}
                          </p>
                          <p className="text-xs text-muted-foreground inline-flex items-center gap-0.5">
                            Within 5%
                            <HelpCircle className="size-2.5 text-muted-foreground/50" />
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[200px]">{METRIC_TOOLTIPS.within5}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="cursor-help">
                          <p className="text-2xl font-semibold">
                            {data.weight_accuracy.resolved > 0
                              ? `${Math.round((data.weight_accuracy.within_10pct / data.weight_accuracy.resolved) * 100)}%`
                              : "—"}
                          </p>
                          <p className="text-xs text-muted-foreground inline-flex items-center gap-0.5">
                            Within 10%
                            <HelpCircle className="size-2.5 text-muted-foreground/50" />
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[200px]">{METRIC_TOOLTIPS.within10}</TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    {data.weight_accuracy.total} total predictions, {data.weight_accuracy.resolved} resolved
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Feedback Trends */}
        {data.feedback_trends.length > 0 && (
          <div className="bg-white rounded-xl border border-border">
            <div className="p-4 border-b border-border">
              <h3 className="font-medium">Feedback Trends (Weekly)</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Track how AI quality changes over time — a sudden drop may need attention
              </p>
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Week</th>
                    <th className="pb-2 font-medium">Accuracy</th>
                    <th className="pb-2 font-medium">Relevance</th>
                    <th className="pb-2 font-medium">Helpfulness</th>
                    <th className="pb-2 font-medium">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.feedback_trends.map((row) => (
                    <tr key={row.week} className="border-t border-border">
                      <td className="py-2 font-mono text-xs">{row.week}</td>
                      <td className="py-2">{row.avg_accuracy?.toFixed(1) ?? "—"}</td>
                      <td className="py-2">{row.avg_relevance?.toFixed(1) ?? "—"}</td>
                      <td className="py-2">{row.avg_helpfulness?.toFixed(1) ?? "—"}</td>
                      <td className="py-2">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <VoiceDriftCard />
      </div>
    </TooltipProvider>
  )
}
