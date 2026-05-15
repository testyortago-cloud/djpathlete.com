import Link from "next/link"
import { ArrowLeft, Radar } from "lucide-react"
import { createServiceRoleClient } from "@/lib/supabase"
import { listSignals } from "@/lib/db/cross-channel-signals"
import { RunCriticButton } from "@/components/admin/strategy/RunCriticButton"
import { StatusPill } from "@/components/admin/strategy/StatusPill"

export const dynamic = "force-dynamic"
export const metadata = { title: "Cross-channel signals" }

const WINDOW_DAYS = 28

export default async function SignalsPage() {
  const sb = createServiceRoleClient()
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [signals, seoRes, adsRes, socialRes, voiceRes] = await Promise.all([
    listSignals(sb, 12),
    sb
      .from("seo_agent_memos")
      .select("id", { count: "exact", head: true })
      .gte("created_at", cutoff),
    sb
      .from("google_ads_agent_memos")
      .select("id", { count: "exact", head: true })
      .gte("created_at", cutoff),
    sb
      .from("social_agent_memos")
      .select("id", { count: "exact", head: true })
      .gte("created_at", cutoff),
    sb
      .from("voice_drift_flags")
      .select("id", { count: "exact", head: true })
      .gte("created_at", cutoff),
  ])

  const counts = {
    seo: seoRes.count ?? 0,
    ads: adsRes.count ?? 0,
    social: socialRes.count ?? 0,
    voice: voiceRes.count ?? 0,
  }
  const channelsWithMemos =
    (counts.seo > 0 ? 1 : 0) + (counts.ads > 0 ? 1 : 0) + (counts.social > 0 ? 1 : 0)
  const preflightOk = channelsWithMemos >= 2

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/strategy"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="size-3" /> Strategy
          </Link>
          <h1 className="font-heading text-3xl text-primary mt-1">Cross-channel signals</h1>
          <p className="text-muted-foreground">
            Each Saturday the critic distills the past {WINDOW_DAYS} days of agent memos and booking
            attribution into a single signal row. The chief reads it on Sunday to draft your brief.
          </p>
        </div>
        <RunCriticButton />
      </header>

      {/* Inputs available for the next critic run */}
      <div className="rounded-xl border border-border bg-white overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Radar className="size-4 text-primary" />
            <h2 className="text-lg font-semibold text-primary">Inputs available now</h2>
          </div>
          <span
            className={`text-xs font-medium ${preflightOk ? "text-success" : "text-warning"}`}
          >
            {preflightOk ? "Preflight: ready" : `Preflight: ${channelsWithMemos}/2 channels`}
          </span>
        </div>
        <div className="divide-y divide-border">
          <InputRow label="SEO memos" table="seo_agent_memos" count={counts.seo} />
          <InputRow label="Ads memos" table="google_ads_agent_memos" count={counts.ads} />
          <InputRow label="Social memos" table="social_agent_memos" count={counts.social} />
          <InputRow label="Voice drift flags" table="voice_drift_flags" count={counts.voice} />
        </div>
      </div>

      {/* Signal feed */}
      <div className="rounded-xl border border-border bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Radar className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">Signal feed</h2>
          {signals.length > 0 && (
            <span className="text-xs text-muted-foreground">({signals.length})</span>
          )}
        </div>

        {signals.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            <p>
              No signals yet. Once the critic runs, you&apos;ll see a row per week here with
              winners, losers, anomalies, attribution summary, and recommendations the chief
              will use.
            </p>
            <div className="mt-4">
              <RunCriticButton label="Run the critic now" />
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {signals.map((s) => {
              const recs = ((s.recommendations_for_brief as unknown[]) ?? []).filter(
                (r): r is string => typeof r === "string",
              )
              return (
                <li key={s.id} className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <p className="font-medium text-primary">Week of {s.week_of}</p>
                    <StatusPill status={s.preflight_status} />
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(s.created_at).toLocaleString()}
                    </span>
                  </div>
                  {s.rationale && (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{s.rationale}</p>
                  )}
                  {recs.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-primary mb-1">
                        Recommendations for next brief
                      </p>
                      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-0.5">
                        {recs.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* How this works footer */}
      <div className="rounded-xl border border-border bg-surface/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-primary">How this works</p>
        <ul className="mt-2 space-y-1 list-disc list-inside">
          <li>
            The critic needs at least <span className="font-medium text-primary">2 of 3</span>{" "}
            specialist channels to have memos in the last {WINDOW_DAYS} days — a preflight guard
            so the synthesis isn&apos;t built on one channel&apos;s noise.
          </li>
          <li>
            When the preflight passes, it writes one{" "}
            <span className="font-medium text-primary">cross_channel_signals</span> row per week
            with winners, losers, anomalies, attribution_summary, and recommendations_for_brief.
          </li>
          <li>
            The chief reads that row Sunday morning to draft your brief — visible on the{" "}
            <Link href="/admin/strategy" className="text-primary hover:underline">
              Strategy
            </Link>{" "}
            page.
          </li>
        </ul>
      </div>
    </div>
  )
}

function InputRow({ label, table, count }: { label: string; table: string; count: number }) {
  return (
    <div className="flex items-center justify-between gap-3 p-4">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-primary text-sm">{label}</p>
        <p className="text-xs text-muted-foreground font-mono">{table}</p>
      </div>
      <span className="text-lg font-semibold text-primary tabular-nums">
        {count.toLocaleString()}
      </span>
    </div>
  )
}
