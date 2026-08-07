import {
  DataTable,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table"

import Link from "next/link"
import { listAgentMemos } from "@/lib/db/google-ads-agent-memos"
import { Badge } from "@/components/ui/badge"
import type { GoogleAdsAgentMemo } from "@/types/database"
import { AskAgentBox } from "./AskAgentBox"
import { GenerateMemoButton } from "./GenerateMemoButton"

export const metadata = { title: "Google Ads — AI Agent" }
export const dynamic = "force-dynamic"

const PRIORITY_TONE: Record<string, string> = {
  high: "bg-error/10 text-error",
  medium: "bg-warning/15 text-warning",
  low: "bg-muted/40 text-muted-foreground",
}

function fmtWeekOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return "just now"
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "link"

function outcomeBadgeVariant(status: GoogleAdsAgentMemo["outcome_status"]): BadgeVariant {
  switch (status) {
    case "measured":
      return "default"
    case "rolled_back":
      return "destructive"
    case "preflight_failed":
      return "outline"
    case "pending":
    default:
      return "secondary"
  }
}

function OutcomeBadge({ memo }: { memo: GoogleAdsAgentMemo }) {
  const label = memo.outcome_status.replace(/_/g, " ")
  return (
    <Badge
      variant={outcomeBadgeVariant(memo.outcome_status)}
      className="text-[10px] font-mono uppercase tracking-wider"
    >
      {label}
    </Badge>
  )
}

function topHeadlineMetric(metrics: Record<string, unknown> | null): string {
  if (!metrics) return ""
  for (const value of Object.values(metrics)) {
    if (value && typeof value === "object") {
      const bucket = value as Record<string, unknown>
      const delta = bucket.CVR_delta_pct
      if (typeof delta === "number" && Number.isFinite(delta)) {
        return `CVR ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`
      }
    }
  }
  return ""
}

export default async function AgentPage() {
  const memos = await listAgentMemos(20)
  const latest = memos[0]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading text-primary">AI Ads Agent</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Senior-marketer agent. Wednesday 13:00 UTC, it reads your full account state (campaigns, recs, conversions,
            audiences, pipeline) and writes a structured strategist memo. You can also ask ad-hoc questions below —
            answers are grounded in the same snapshot.
          </p>
        </div>
        <GenerateMemoButton />
      </div>

      <section>
        <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
          ─ Ask the agent
        </h2>
        <AskAgentBox />
      </section>

      <section>
        <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
          ─ Latest strategist memo
        </h2>
        {!latest ? (
          <div className="border border-dashed border-border rounded-xl p-6 bg-card text-sm text-muted-foreground text-center">
            No memos yet. Click <strong>Generate now</strong> above to ask the agent for the first one — runs in ~30
            seconds.
          </div>
        ) : (
          <div className="border border-border rounded-xl bg-card p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Week of {fmtWeekOf(latest.week_of)} · {relativeTime(latest.created_at)}
                </p>
                <h3 className="font-heading text-xl text-primary mt-1">{latest.subject}</h3>
                <div className="flex items-center gap-2 mt-2">
                  <OutcomeBadge memo={latest} />
                  {topHeadlineMetric(latest.outcome_metrics) ? (
                    <span className="text-xs font-mono text-muted-foreground">
                      {topHeadlineMetric(latest.outcome_metrics)}
                    </span>
                  ) : null}
                </div>
              </div>
              <Link
                href={`/admin/ads/agent/${latest.id}`}
                className="text-xs px-3 py-1.5 rounded-md border border-border hover:border-accent/60 hover:text-accent transition-colors"
              >
                View full memo →
              </Link>
            </div>
            <p className="text-sm text-primary leading-relaxed">{latest.sections.executive_summary}</p>
            {latest.sections.recommended_actions.length > 0 ? (
              <div className="border-t border-border/60 pt-4 space-y-2">
                <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Top actions this week
                </p>
                {latest.sections.recommended_actions.slice(0, 3).map((a, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span
                      className={`shrink-0 inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${PRIORITY_TONE[a.priority] ?? "bg-muted/40 text-muted-foreground"}`}
                    >
                      {a.priority}
                    </span>
                    <div className="flex-1 min-w-0">
                      {a.link ? (
                        <Link href={a.link} className="text-sm font-medium text-primary hover:text-accent">
                          {a.title}
                        </Link>
                      ) : (
                        <p className="text-sm font-medium text-primary">{a.title}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{a.reasoning.slice(0, 240)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </section>

      {memos.length > 1 ? (
        <section>
          <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
            ─ Memo archive
          </h2>
          <DataTableCard>
            <DataTable>
              <DataTableHeader>
                <DataTableHead className="w-32">Week of</DataTableHead>
                <DataTableHead>Subject</DataTableHead>
                <DataTableHead className="w-40">Outcome</DataTableHead>
                <DataTableHead className="w-24">Source</DataTableHead>
                <DataTableHead className="w-32">Sent to</DataTableHead>
              </DataTableHeader>
              <tbody>
                {memos.slice(1).map((m) => {
                  const headline = topHeadlineMetric(m.outcome_metrics)
                  return (
                    <DataTableRow key={m.id}>
                      <DataTableCell className="font-mono text-xs">{fmtWeekOf(m.week_of)}</DataTableCell>
                      <DataTableCell>
                        <Link href={`/admin/ads/agent/${m.id}`} className="text-primary hover:text-accent">
                          {m.subject}
                        </Link>
                      </DataTableCell>
                      <DataTableCell>
                        <div className="flex items-center gap-2">
                          <OutcomeBadge memo={m} />
                          {headline ? (
                            <span className="text-xs font-mono text-muted-foreground">{headline}</span>
                          ) : null}
                        </div>
                      </DataTableCell>
                      <DataTableCell className="text-xs">{m.source}</DataTableCell>
                      <DataTableCell muted className="text-xs font-mono">
                        {m.email_recipient ?? "—"}
                      </DataTableCell>
                    </DataTableRow>
                  )
                })}
              </tbody>
            </DataTable>
          </DataTableCard>
        </section>
      ) : null}
    </div>
  )
}
