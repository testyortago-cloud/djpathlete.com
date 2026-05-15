import Link from "next/link"
import {
  Activity,
  ArrowUpRight,
  Compass,
  Megaphone,
  Radar,
  Sparkles,
} from "lucide-react"
import { createServiceRoleClient } from "@/lib/supabase"
import { listBriefs } from "@/lib/db/strategy-briefs"
import { listSignals } from "@/lib/db/cross-channel-signals"
import { chiefMemoForBrief } from "@/lib/db/chief-strategist-memos"
import { BriefEditor } from "@/components/admin/strategy/BriefEditor"
import { BriefCard } from "@/components/admin/strategy/BriefCard"
import { RunCriticButton } from "@/components/admin/strategy/RunCriticButton"
import { RunChiefButton } from "@/components/admin/strategy/RunChiefButton"
import { StatusPill } from "@/components/admin/strategy/StatusPill"

export const dynamic = "force-dynamic"
export const metadata = { title: "Strategy" }

const STEPS = [
  {
    label: "Performance Critic",
    schedule: "Saturday · 13:00 UTC",
    description:
      "Reads the last 28 days of agent memos + booking attribution + voice flags. Writes one signal row summarizing winners, losers, anomalies, and recommendations.",
    icon: Radar,
  },
  {
    label: "Chief Strategist",
    schedule: "Sunday · 10:00 UTC",
    description:
      "Reads the freshest signal and the last 4 briefs. Drafts next week's strategy brief. You approve it before any specialist agent picks it up.",
    icon: Compass,
  },
  {
    label: "Specialists",
    schedule: "Tue · Wed · Thu (varying times)",
    description:
      "SEO, Ads, and Social each read the approved brief on their next run. Themes bias their action ranking; the dont_do list is a hard guardrail.",
    icon: Megaphone,
  },
  {
    label: "Outcome Tracker",
    schedule: "Daily · 04:45 UTC",
    description:
      "Memos older than 14 days get outcome_metrics filled in. That outcome history is what next Saturday's critic reads — closing the learning loop.",
    icon: Activity,
  },
] as const

export default async function StrategyPage() {
  const sb = createServiceRoleClient()
  const [briefs, signals] = await Promise.all([listBriefs(sb, 8), listSignals(sb, 1)])
  const draft = briefs.find((b) => b.approval_status === "draft") ?? null
  const history = briefs.filter((b) => b.id !== draft?.id)
  const latestSignal = signals[0] ?? null
  const chiefMemo = draft ? await chiefMemoForBrief(sb, draft.id) : null

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl text-primary">Strategy</h1>
          <p className="text-muted-foreground">
            One weekly brief steers SEO, Ads, and Social as a team. The critic reads what worked
            on Saturdays; the chief drafts next week&apos;s direction on Sundays. You approve here.
          </p>
        </div>
        <Link
          href="/admin/strategy/signals"
          className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View signals
          <ArrowUpRight className="size-3.5" />
        </Link>
      </header>

      {/* Current brief */}
      <div className="rounded-xl border border-border bg-white overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h2 className="text-lg font-semibold text-primary">This week&apos;s brief</h2>
            {draft && <StatusPill status={draft.approval_status} />}
          </div>
          {!draft && <RunChiefButton />}
        </div>

        {draft ? (
          <div className="p-4 space-y-4">
            <BriefEditor brief={draft} />
            {chiefMemo && (
              <section className="rounded-md border border-border bg-surface p-4">
                <header className="flex items-center justify-between">
                  <h3 className="font-heading text-lg">Chief reasoning</h3>
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        chiefMemo.confidence == null
                          ? "rounded bg-muted px-2 py-1 text-xs"
                          : chiefMemo.confidence >= 7
                            ? "rounded bg-success/20 px-2 py-1 text-xs text-success"
                            : chiefMemo.confidence >= 4
                              ? "rounded bg-warning/20 px-2 py-1 text-xs text-warning"
                              : "rounded bg-error/20 px-2 py-1 text-xs text-error"
                      }
                    >
                      confidence {chiefMemo.confidence ?? "—"}/10
                    </span>
                    {chiefMemo.dissents_from_critic && (
                      <span
                        className="rounded bg-accent/20 px-2 py-1 text-xs text-accent"
                        title={chiefMemo.dissent_reason ?? ""}
                      >
                        dissents from Critic
                      </span>
                    )}
                  </div>
                </header>
                {chiefMemo.themes_considered.length > 0 && (
                  <div className="mt-3">
                    <h4 className="font-heading text-sm">Themes considered</h4>
                    <ul className="mt-1 space-y-1 text-sm">
                      {chiefMemo.themes_considered.map((t) => (
                        <li key={t.tag}>
                          <span
                            className={
                              t.accepted ? "" : "text-muted-foreground line-through"
                            }
                          >
                            {t.tag} (weight {t.weight.toFixed(2)})
                          </span>
                          <span className="text-muted-foreground"> — {t.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {chiefMemo.dissent_reason && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    <span className="font-heading">Dissent:</span> {chiefMemo.dissent_reason}
                  </p>
                )}
              </section>
            )}
          </div>
        ) : (
          <div className="p-6 text-sm text-muted-foreground">
            <p>
              No draft for this week yet. The chief runs every Sunday at 10:00 UTC and drops a draft
              here. You can also trigger it now — it takes under a minute.
            </p>
            <p className="mt-3 text-xs">
              The chief needs at least one recent <span className="font-medium text-primary">cross_channel_signals</span> row
              to work. If there&apos;s none yet, run the critic first.
            </p>
          </div>
        )}
      </div>

      {/* Latest signal preview */}
      {latestSignal && (
        <div className="rounded-xl border border-border bg-white overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Radar className="size-4 text-primary" />
              <h2 className="text-lg font-semibold text-primary">Latest signal</h2>
              <StatusPill status={latestSignal.preflight_status} />
            </div>
            <Link
              href="/admin/strategy/signals"
              className="text-xs font-medium text-primary hover:underline"
            >
              See all →
            </Link>
          </div>
          <div className="p-4 space-y-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-primary">Week of:</span> {latestSignal.week_of}
            </p>
            <p className="text-sm text-foreground line-clamp-4 whitespace-pre-wrap">
              {latestSignal.rationale}
            </p>
          </div>
        </div>
      )}

      {/* How the team runs */}
      <div className="rounded-xl border border-border bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Compass className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">How the team runs each week</h2>
        </div>
        <ol className="divide-y divide-border">
          {STEPS.map((step) => {
            const Icon = step.icon
            return (
              <li
                key={step.label}
                className="flex flex-col sm:flex-row sm:items-start sm:gap-4 p-4"
              >
                <div className="flex items-center gap-2 sm:w-44 shrink-0">
                  <Icon className="size-4 text-primary" />
                  <div>
                    <p className="font-medium text-primary text-sm">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.schedule}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-1 sm:mt-0">{step.description}</p>
              </li>
            )
          })}
        </ol>
      </div>

      {/* Brief history */}
      {history.length > 0 && (
        <div className="rounded-xl border border-border bg-white overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Sparkles className="size-4 text-primary" />
            <h2 className="text-lg font-semibold text-primary">Brief history</h2>
            <span className="text-xs text-muted-foreground">({history.length})</span>
          </div>
          <ul className="divide-y divide-border">
            {history.map((b) => (
              <li key={b.id}>
                <BriefCard brief={b} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* How this works footer */}
      <div className="rounded-xl border border-border bg-surface/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-primary">How this works</p>
        <ul className="mt-2 space-y-1 list-disc list-inside">
          <li>
            <span className="font-medium text-primary">Run critic</span> — synthesizes the last
            28 days into a signal row. Needs at least 2 of 3 channels with memos.
          </li>
          <li>
            <span className="font-medium text-primary">Run chief</span> — reads the latest signal +
            last 4 briefs and drafts a new brief here. You can edit it before approving.
          </li>
          <li>
            Specialists (SEO, Ads, Social) automatically read the latest approved brief on their
            next scheduled run. The dont_do list is enforced as a hard guardrail.
          </li>
          <li>
            All four crons default off — flip them on from <Link href="/admin/automation" className="text-primary hover:underline">Automation</Link> once you&apos;ve smoked a manual run.
          </li>
        </ul>
        <div className="flex flex-wrap gap-2 mt-4">
          <RunCriticButton />
          <RunChiefButton />
        </div>
      </div>
    </div>
  )
}
