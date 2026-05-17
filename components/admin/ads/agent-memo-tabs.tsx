"use client"

import Link from "next/link"
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  Braces,
  CheckCircle2,
  CircleDot,
  Eye,
  Flag,
  Lightbulb,
  ListChecks,
  Radar,
  ShieldOff,
  Sparkles,
  TrendingUp,
  Wrench,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  GoogleAdsAgentMemo,
  GoogleAdsAgentMemoAction,
  GoogleAdsAgentMemoGuardrailRejection,
  GoogleAdsAgentRecommendedAction,
} from "@/types/database"

const PRIORITY_RANK: Record<GoogleAdsAgentRecommendedAction["priority"], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

const PRIORITY_CARD: Record<GoogleAdsAgentRecommendedAction["priority"], string> = {
  high: "border-error/50 bg-error/5",
  medium: "border-warning/40 bg-warning/5",
  low: "border-border bg-card",
}

const PRIORITY_CHIP: Record<GoogleAdsAgentRecommendedAction["priority"], string> = {
  high: "bg-error text-white",
  medium: "bg-warning/90 text-white",
  low: "bg-muted text-muted-foreground",
}

const PRIORITY_RING: Record<GoogleAdsAgentRecommendedAction["priority"], string> = {
  high: "bg-error/15 text-error ring-1 ring-error/30",
  medium: "bg-warning/15 text-warning ring-1 ring-warning/30",
  low: "bg-muted text-muted-foreground ring-1 ring-border",
}

const PRIORITY_ICON: Record<GoogleAdsAgentRecommendedAction["priority"], React.ComponentType<{ className?: string }>> = {
  high: Flag,
  medium: AlertTriangle,
  low: Lightbulb,
}

type ActionStatus = GoogleAdsAgentMemoAction["status"]

const STATUS_TONE: Record<ActionStatus, string> = {
  applied: "border-success/40 bg-success/5",
  queued: "border-border bg-card",
  failed: "border-error/50 bg-error/5",
  rejected_by_guardrails: "border-warning/40 bg-warning/5",
}

const STATUS_CHIP: Record<ActionStatus, string> = {
  applied: "bg-success/15 text-success ring-1 ring-success/30",
  queued: "bg-muted text-muted-foreground ring-1 ring-border",
  failed: "bg-error/15 text-error ring-1 ring-error/30",
  rejected_by_guardrails: "bg-warning/15 text-warning ring-1 ring-warning/30",
}

const CONFIDENCE_CHIP: Record<"low" | "medium" | "high", string> = {
  high: "bg-success/10 text-success ring-1 ring-success/20",
  medium: "bg-warning/10 text-warning ring-1 ring-warning/20",
  low: "bg-error/10 text-error ring-1 ring-error/20",
}

interface AgentMemoTabsProps {
  memo: GoogleAdsAgentMemo
}

export function AgentMemoTabs({ memo }: AgentMemoTabsProps) {
  const s = memo.sections
  const sortedActions = [...s.recommended_actions].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
  )
  const watchItems = parseWatchList(s.watch_list)

  return (
    <Tabs defaultValue="memo" className="w-full">
      <TabsList className="bg-surface/60 border border-border">
        <TabsTrigger value="memo">Memo</TabsTrigger>
        <TabsTrigger value="signals">Signals</TabsTrigger>
        <TabsTrigger value="actions">Actions</TabsTrigger>
        <TabsTrigger value="outcomes">Outcomes</TabsTrigger>
      </TabsList>

      <TabsContent value="memo" className="space-y-10 pt-6">
        {/* Hero: Executive summary */}
        <section className="relative overflow-hidden rounded-xl border border-border bg-card">
          <div className="absolute inset-y-0 left-0 w-1 bg-accent" aria-hidden />
          <div className="p-6 sm:p-7">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="size-3.5 text-accent" />
              <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent">
                Executive summary
              </span>
            </div>
            <p className="text-lg leading-relaxed text-primary font-body">
              {s.executive_summary}
            </p>
          </div>
        </section>

        {/* Pulse: What's working / What's not */}
        {(s.whats_working.length > 0 || s.whats_not.length > 0) && (
          <section>
            <SectionHeading icon={TrendingUp} title="Pulse" subtitle="What moved, and what didn't" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <PulseColumn
                tone="success"
                heading="What's working"
                count={s.whats_working.length}
                items={s.whats_working}
                emptyLabel="Nothing flagged"
              />
              <PulseColumn
                tone="error"
                heading="What's not"
                count={s.whats_not.length}
                items={s.whats_not}
                emptyLabel="Nothing flagged"
              />
            </div>
          </section>
        )}

        {/* Recommended actions */}
        {sortedActions.length > 0 && (
          <section>
            <SectionHeading
              icon={ListChecks}
              title="Recommended actions"
              subtitle={`${sortedActions.length} prioritized ${sortedActions.length === 1 ? "play" : "plays"}`}
            />
            <ol className="space-y-3">
              {sortedActions.map((a, i) => {
                const Icon = PRIORITY_ICON[a.priority]
                return (
                  <li
                    key={i}
                    className={`relative rounded-xl border p-5 ${PRIORITY_CARD[a.priority]}`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                        <span className="font-mono text-xs text-muted-foreground">
                          #{i + 1}
                        </span>
                        <span
                          className={`inline-flex size-7 items-center justify-center rounded-full ${PRIORITY_RING[a.priority]}`}
                        >
                          <Icon className="size-3.5" />
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${PRIORITY_CHIP[a.priority]}`}
                          >
                            {a.priority}
                          </span>
                          {a.link ? (
                            <Link
                              href={a.link}
                              className="text-base font-medium text-primary hover:text-accent"
                            >
                              {a.title}
                            </Link>
                          ) : (
                            <span className="text-base font-medium text-primary">
                              {a.title}
                            </span>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {a.reasoning}
                        </p>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        {/* Watch next week */}
        <section>
          <SectionHeading icon={Eye} title="Watch next week" subtitle="Signals to check on the next run" />
          <div className="rounded-xl border border-border bg-surface/50 p-5">
            {watchItems.length > 1 ? (
              <ul className="space-y-2">
                {watchItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-accent"
                      aria-hidden
                    />
                    <span className="text-sm leading-relaxed text-primary">{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-relaxed text-primary">{s.watch_list}</p>
            )}
          </div>
        </section>
      </TabsContent>

      <TabsContent value="signals" className="space-y-6 pt-6">
        <SignalsPanel signals={memo.signals_summary} />
      </TabsContent>

      <TabsContent value="actions" className="space-y-8 pt-6">
        <ActionsPanel
          actions={memo.actions}
          rejections={memo.guardrail_rejections}
        />
      </TabsContent>

      <TabsContent value="outcomes" className="space-y-6 pt-6">
        <OutcomesPanel
          status={memo.outcome_status}
          metrics={memo.outcome_metrics}
          impactScore={memo.impact_score}
          actions={memo.actions}
        />
      </TabsContent>
    </Tabs>
  )
}

function SectionHeading({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle?: string
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3 border-b border-border/70 pb-2">
      <div className="flex items-center gap-2.5">
        <Icon className="size-4 text-accent" />
        <h2 className="font-heading text-lg text-primary">{title}</h2>
      </div>
      {subtitle ? (
        <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
          {subtitle}
        </p>
      ) : null}
    </div>
  )
}

function PulseColumn({
  tone,
  heading,
  count,
  items,
  emptyLabel,
}: {
  tone: "success" | "error"
  heading: string
  count: number
  items: string[]
  emptyLabel: string
}) {
  const isSuccess = tone === "success"
  const Icon = isSuccess ? CheckCircle2 : AlertTriangle
  const accentClass = isSuccess ? "text-success" : "text-error"
  const ringClass = isSuccess
    ? "bg-success/10 text-success ring-1 ring-success/30"
    : "bg-error/10 text-error ring-1 ring-error/30"

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/70 bg-surface/40">
        <div className="flex items-center gap-2">
          <Icon className={`size-4 ${accentClass}`} />
          <h3 className="font-heading text-sm text-primary">{heading}</h3>
        </div>
        <span
          className={`inline-flex size-6 items-center justify-center rounded-full text-[11px] font-mono font-medium ${ringClass}`}
        >
          {count}
        </span>
      </header>
      <div className="p-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">{emptyLabel}</p>
        ) : (
          <ul className="space-y-3">
            {items.map((p, i) => (
              <li key={i} className="text-sm leading-relaxed text-primary">
                {p}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function parseWatchList(raw: string): string[] {
  if (!raw) return []
  if (raw.includes(" • ")) {
    return raw
      .split(" • ")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (raw.includes("•")) {
    return raw
      .split("•")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (raw.includes("\n")) {
    return raw
      .split("\n")
      .map((s) => s.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
  }
  return [raw]
}

// ─────────────────────────────────────────────
// Signals tab
// ─────────────────────────────────────────────

function SignalsPanel({ signals }: { signals: Record<string, unknown> | null }) {
  if (!signals) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/40 p-8 text-center">
        <Radar className="size-5 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No signals captured for this memo.</p>
      </div>
    )
  }

  const keys = Object.keys(signals)
  const gaps = Array.isArray((signals as Record<string, unknown>).gaps)
    ? ((signals as Record<string, unknown>).gaps as unknown[]).map(String)
    : []

  return (
    <>
      <section>
        <SectionHeading
          icon={Radar}
          title="Signals snapshot"
          subtitle={`${keys.length} ${keys.length === 1 ? "source" : "sources"}`}
        />
        <p className="text-sm text-muted-foreground mb-4">
          The full account state the agent read at run time — campaigns, recommendations,
          conversions, audiences, and pipeline.
        </p>
        {keys.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {keys.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-mono text-muted-foreground"
              >
                <CircleDot className="size-2.5 text-accent" />
                {k}
              </span>
            ))}
          </div>
        )}
      </section>

      {gaps.length > 0 && (
        <section className="rounded-xl border border-warning/40 bg-warning/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="size-4 text-warning" />
            <h3 className="font-heading text-sm text-primary">Data gaps</h3>
          </div>
          <ul className="space-y-1">
            {gaps.map((g, i) => (
              <li key={i} className="text-sm text-primary leading-relaxed">
                {g}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <details className="rounded-xl border border-border bg-card overflow-hidden group" open>
          <summary className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer border-b border-border/70 bg-surface/40 hover:bg-surface/70 transition-colors list-none [&::-webkit-details-marker]:hidden">
            <div className="flex items-center gap-2">
              <Braces className="size-4 text-accent" />
              <h3 className="font-heading text-sm text-primary">Raw JSON</h3>
            </div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground group-open:hidden">
              click to expand
            </span>
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground hidden group-open:inline">
              click to collapse
            </span>
          </summary>
          <pre className="text-xs overflow-auto p-4 max-h-[60vh] font-mono leading-relaxed text-primary">
            {JSON.stringify(signals, null, 2)}
          </pre>
        </details>
      </section>
    </>
  )
}

// ─────────────────────────────────────────────
// Actions tab
// ─────────────────────────────────────────────

function ActionsPanel({
  actions,
  rejections,
}: {
  actions: GoogleAdsAgentMemoAction[]
  rejections: GoogleAdsAgentMemoGuardrailRejection[]
}) {
  const liveActions = actions.filter((a) => a.status !== "rejected_by_guardrails")
  const applied = liveActions.filter((a) => a.status === "applied").length
  const queued = liveActions.filter((a) => a.status === "queued").length
  const failed = liveActions.filter((a) => a.status === "failed").length

  return (
    <>
      <section>
        <SectionHeading
          icon={Wrench}
          title="Queued / applied"
          subtitle={
            liveActions.length === 0
              ? "Nothing to apply"
              : `${applied} applied · ${queued} queued${failed ? ` · ${failed} failed` : ""}`
          }
        />
        {liveActions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface/40 p-6 text-center">
            <p className="text-sm text-muted-foreground">No actions in this memo.</p>
          </div>
        ) : (
          <ol className="space-y-3">
            {liveActions.map((a) => (
              <li
                key={a.rank}
                className={`rounded-xl border p-5 ${STATUS_TONE[a.status]}`}
              >
                <ActionCard action={a} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {rejections.length > 0 && (
        <section>
          <SectionHeading
            icon={ShieldOff}
            title="Rejected by guardrails"
            subtitle={`${rejections.length} blocked`}
          />
          <ul className="space-y-3">
            {rejections.map((r, i) => (
              <li
                key={`${r.rank}-${i}`}
                className="rounded-xl border border-warning/40 bg-warning/5 p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning ring-1 ring-warning/30">
                    <ShieldOff className="size-3" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{r.rank}
                      </span>
                      <strong className="text-sm font-medium text-primary">
                        {r.tool.replace(/_/g, " ")}
                      </strong>
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground mt-1">
                      {r.reason}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function ActionCard({ action }: { action: GoogleAdsAgentMemoAction }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-muted-foreground">
            #{action.rank}
          </span>
          <strong className="text-base font-medium text-primary">
            {action.tool.replace(/_/g, " ")}
          </strong>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${STATUS_CHIP[action.status]}`}
        >
          {action.status === "applied" && <CheckCircle2 className="size-3" />}
          {action.status === "failed" && <AlertOctagon className="size-3" />}
          {action.status === "queued" && <CircleDot className="size-3" />}
          {action.status.replace(/_/g, " ")}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-primary">{action.rationale}</p>

      <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
        <MetaChip label="model" value={action.confidence} chipClass={CONFIDENCE_CHIP[action.confidence]} />
        <MetaChip label="audit" value={action.audit_confidence} chipClass={CONFIDENCE_CHIP[action.audit_confidence]} />
        <MetaChip label="signif" value={action.significance} />
        <MetaChip label="expects" value={`${action.expected_metric} ${action.expected_direction === "increase" ? "↑" : "↓"}`} />
        {action.clamped && <MetaChip label="" value="clamped" tone="warning" />}
      </div>

      <details className="rounded-md border border-border/70 bg-surface/40 overflow-hidden group">
        <summary className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-primary transition-colors list-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
          <span>Tool args</span>
          <span className="group-open:rotate-90 transition-transform">›</span>
        </summary>
        <pre className="text-xs p-3 overflow-auto font-mono text-primary">
          {JSON.stringify(action.args, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function MetaChip({
  label,
  value,
  chipClass,
  tone,
}: {
  label: string
  value: string
  chipClass?: string
  tone?: "warning"
}) {
  const cls =
    chipClass ??
    (tone === "warning"
      ? "bg-warning/10 text-warning ring-1 ring-warning/30"
      : "bg-muted text-muted-foreground ring-1 ring-border")
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${cls}`}>
      {label ? <span className="opacity-60">{label}:</span> : null}
      <span>{value}</span>
    </span>
  )
}

// ─────────────────────────────────────────────
// Outcomes tab
// ─────────────────────────────────────────────

function OutcomesPanel({
  status,
  metrics,
  impactScore,
  actions,
}: {
  status: GoogleAdsAgentMemo["outcome_status"]
  metrics: Record<string, unknown> | null
  impactScore: number | null
  actions: GoogleAdsAgentMemoAction[]
}) {
  if (status !== "measured") {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/40 p-8 text-center">
        <Activity className="size-5 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          Outcomes will appear once applied actions complete their 14-day window.
        </p>
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mt-2">
          status: {status}
        </p>
      </div>
    )
  }

  if (!metrics) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/40 p-8 text-center">
        <p className="text-sm text-muted-foreground">No metrics yet.</p>
      </div>
    )
  }

  const appliedActions = actions.filter((a) => a.status === "applied")
  if (appliedActions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/40 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No applied actions to report outcomes for.
        </p>
      </div>
    )
  }

  return (
    <>
      {impactScore !== null && (
        <ImpactBanner impactScore={impactScore} count={appliedActions.length} />
      )}

      <section>
        <SectionHeading
          icon={BarChart3}
          title="Measured outcomes"
          subtitle={`${appliedActions.length} ${appliedActions.length === 1 ? "action" : "actions"} · 14-day window`}
        />
        <div className="space-y-3">
          {appliedActions.map((a) => {
            const args = a.args as Record<string, unknown>
            const key =
              (args.campaign_id as string | undefined) ??
              a.recommendation_id ??
              `r${a.rank}`
            const bucket = (metrics[key] as Record<string, number> | undefined) ?? {}
            return (
              <article
                key={a.rank}
                className="rounded-xl border border-border bg-card p-5"
              >
                <header className="flex items-center justify-between gap-2 flex-wrap mb-4">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      #{a.rank}
                    </span>
                    <strong className="text-base font-medium text-primary">
                      {a.tool.replace(/_/g, " ")}
                    </strong>
                  </div>
                </header>
                <div className="grid grid-cols-3 gap-3">
                  <DeltaStat label="CTR" delta={bucket.CTR_delta_pct} />
                  <DeltaStat label="CVR" delta={bucket.CVR_delta_pct} />
                  <DeltaStat label="CAC" delta={bucket.CAC_delta_pct} invert />
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </>
  )
}

function ImpactBanner({ impactScore, count }: { impactScore: number; count: number }) {
  const tone =
    impactScore >= 25
      ? "border-success/50 bg-success/5"
      : impactScore <= -25
        ? "border-error/50 bg-error/5"
        : "border-border bg-surface/40"
  const valueTone =
    impactScore >= 25
      ? "text-success"
      : impactScore <= -25
        ? "text-error"
        : "text-muted-foreground"
  return (
    <section className={`rounded-xl border ${tone} p-5`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            Impact score
          </p>
          <p className={`font-heading text-3xl ${valueTone} mt-1 tabular-nums`}>
            {impactScore > 0 ? "+" : ""}
            {impactScore}
          </p>
        </div>
        <p className="text-xs text-muted-foreground max-w-xs text-right">
          Normalized vs. the running P95 baseline for this tool across {count}{" "}
          measured {count === 1 ? "action" : "actions"}.
        </p>
      </div>
    </section>
  )
}

function DeltaStat({
  label,
  delta,
  invert,
}: {
  label: string
  delta: number | undefined
  invert?: boolean
}) {
  const isFinite = typeof delta === "number" && Number.isFinite(delta)
  const positive = isFinite && (invert ? (delta as number) < 0 : (delta as number) > 0)
  const negative = isFinite && (invert ? (delta as number) > 0 : (delta as number) < 0)
  const tone = positive ? "text-success" : negative ? "text-error" : "text-muted-foreground"
  return (
    <div className="rounded-md border border-border/70 bg-surface/40 px-3 py-2">
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label} Δ
      </p>
      <p className={`font-mono text-base tabular-nums mt-0.5 ${tone}`}>
        {fmtPct(delta)}
      </p>
    </div>
  )
}

function fmtPct(v: number | undefined): string {
  if (v == null) return "—"
  if (!Number.isFinite(v)) return "n/a"
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`
}
