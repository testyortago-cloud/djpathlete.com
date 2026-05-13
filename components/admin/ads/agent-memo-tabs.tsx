"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  GoogleAdsAgentMemo,
  GoogleAdsAgentMemoAction,
  GoogleAdsAgentMemoGuardrailRejection,
} from "@/types/database"

const PRIORITY_TONE: Record<string, string> = {
  high: "bg-error/10 text-error border-error/40",
  medium: "bg-warning/15 text-warning border-warning/40",
  low: "bg-muted/40 text-muted-foreground border-border",
}

interface AgentMemoTabsProps {
  memo: GoogleAdsAgentMemo
}

export function AgentMemoTabs({ memo }: AgentMemoTabsProps) {
  const s = memo.sections

  return (
    <Tabs defaultValue="memo" className="w-full">
      <TabsList>
        <TabsTrigger value="memo">Memo</TabsTrigger>
        <TabsTrigger value="signals">Signals</TabsTrigger>
        <TabsTrigger value="actions">Actions</TabsTrigger>
        <TabsTrigger value="outcomes">Outcomes</TabsTrigger>
      </TabsList>

      <TabsContent value="memo" className="space-y-8 pt-4">
        <Section title="Executive summary">
          <p className="text-base leading-relaxed text-primary">{s.executive_summary}</p>
        </Section>

        {s.whats_working.length > 0 ? (
          <Section title="What's working">
            <div className="space-y-3">
              {s.whats_working.map((p, i) => (
                <p key={i} className="text-sm text-primary leading-relaxed">
                  {p}
                </p>
              ))}
            </div>
          </Section>
        ) : null}

        {s.whats_not.length > 0 ? (
          <Section title="What's not">
            <div className="space-y-3">
              {s.whats_not.map((p, i) => (
                <p key={i} className="text-sm text-primary leading-relaxed">
                  {p}
                </p>
              ))}
            </div>
          </Section>
        ) : null}

        {s.recommended_actions.length > 0 ? (
          <Section title="Recommended actions">
            <div className="space-y-3">
              {s.recommended_actions.map((a, i) => (
                <div
                  key={i}
                  className={`border rounded-xl p-4 ${PRIORITY_TONE[a.priority] ?? "bg-card border-border"}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider opacity-90">
                      {a.priority}
                    </span>
                    <span className="text-xs opacity-50">·</span>
                    {a.link ? (
                      <Link href={a.link} className="text-sm font-medium hover:underline">
                        {a.title}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium">{a.title}</span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed opacity-90">{a.reasoning}</p>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title="Watch next week">
          <p className="text-sm leading-relaxed text-primary">{s.watch_list}</p>
        </Section>
      </TabsContent>

      <TabsContent value="signals" className="pt-4">
        {memo.signals_summary ? (
          <pre className="text-xs overflow-auto p-4 bg-muted rounded-md max-h-[70vh]">
            {JSON.stringify(memo.signals_summary, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">No signals captured for this memo.</p>
        )}
      </TabsContent>

      <TabsContent value="actions" className="pt-4">
        <ActionsTable actions={memo.actions} rejections={memo.guardrail_rejections} />
      </TabsContent>

      <TabsContent value="outcomes" className="pt-4">
        {memo.outcome_status === "measured" ? (
          <OutcomesPanel metrics={memo.outcome_metrics} actions={memo.actions} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Outcomes will appear once applied actions complete their 14-day window.
          </p>
        )}
      </TabsContent>
    </Tabs>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
        ─ {title}
      </h2>
      {children}
    </section>
  )
}

function ActionsTable({
  actions,
  rejections,
}: {
  actions: GoogleAdsAgentMemoAction[]
  rejections: GoogleAdsAgentMemoGuardrailRejection[]
}) {
  const liveActions = actions.filter((a) => a.status !== "rejected_by_guardrails")

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          ─ Queued / applied
        </h3>
        {liveActions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No actions in this memo.</p>
        ) : (
          liveActions.map((a) => (
            <div key={a.rank} className="border border-border rounded-xl p-4 bg-card">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <strong className="text-sm font-medium text-primary">
                  {a.tool.replace(/_/g, " ")}
                </strong>
                <Badge variant="outline">{a.status}</Badge>
                <Badge variant="outline">model: {a.confidence}</Badge>
                <Badge variant="outline">audit: {a.audit_confidence}</Badge>
                <Badge variant="outline">{a.significance}</Badge>
                {a.clamped ? <Badge variant="outline">clamped</Badge> : null}
              </div>
              <p className="text-sm leading-relaxed text-primary mt-2">{a.rationale}</p>
              <pre className="text-xs mt-3 bg-muted p-2 rounded-md overflow-auto">
                {JSON.stringify(a.args, null, 2)}
              </pre>
            </div>
          ))
        )}
      </div>

      {rejections.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            ─ Rejected by guardrails
          </h3>
          {rejections.map((r, i) => (
            <div
              key={`${r.rank}-${i}`}
              className="border border-border rounded-xl p-4 bg-muted/40"
            >
              <strong className="text-sm font-medium text-primary">
                {r.tool.replace(/_/g, " ")}
              </strong>
              <p className="text-sm text-muted-foreground mt-1">{r.reason}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function OutcomesPanel({
  metrics,
  actions,
}: {
  metrics: Record<string, unknown> | null
  actions: GoogleAdsAgentMemoAction[]
}) {
  if (!metrics) {
    return <p className="text-sm text-muted-foreground">No metrics yet.</p>
  }

  const appliedActions = actions.filter((a) => a.status === "applied")
  if (appliedActions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No applied actions to report outcomes for.</p>
    )
  }

  return (
    <div className="space-y-3">
      {appliedActions.map((a) => {
        const args = a.args as Record<string, unknown>
        const key =
          (args.campaign_id as string | undefined) ??
          a.recommendation_id ??
          `r${a.rank}`
        const bucket = (metrics[key] as Record<string, number> | undefined) ?? {}
        return (
          <div key={a.rank} className="border border-border rounded-xl p-4 bg-card">
            <strong className="text-sm font-medium text-primary">
              {a.tool.replace(/_/g, " ")}
            </strong>
            <div className="text-sm mt-2 grid grid-cols-3 gap-2 text-primary">
              <div>
                <span className="text-xs text-muted-foreground">CTR Δ</span>
                <div className="font-mono">{fmtPct(bucket.CTR_delta_pct)}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">CVR Δ</span>
                <div className="font-mono">{fmtPct(bucket.CVR_delta_pct)}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">CAC Δ</span>
                <div className="font-mono">{fmtPct(bucket.CAC_delta_pct)}</div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function fmtPct(v: number | undefined): string {
  if (v == null) return "—"
  if (!Number.isFinite(v)) return "n/a"
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`
}
