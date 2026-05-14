import { createServiceRoleClient } from "@/lib/supabase"
import { listBriefs } from "@/lib/db/strategy-briefs"
import { listSignals } from "@/lib/db/cross-channel-signals"
import { BriefEditor } from "@/components/admin/strategy/BriefEditor"
import Link from "next/link"

export const dynamic = "force-dynamic"

export default async function StrategyPage() {
  const sb = createServiceRoleClient()
  const [briefs, signals] = await Promise.all([listBriefs(sb, 8), listSignals(sb, 4)])
  const draft = briefs.find((b) => b.approval_status === "draft") ?? null
  const history = briefs.filter((b) => b !== draft)

  return (
    <div className="space-y-8 p-6">
      <header className="flex items-center justify-between">
        <h1 className="font-heading text-3xl">Strategy</h1>
        <Link href="/admin/strategy/signals" className="text-sm underline decoration-accent underline-offset-4">
          View signals →
        </Link>
      </header>

      <section>
        <h2 className="font-heading text-xl">Current draft</h2>
        {draft ? (
          <BriefEditor brief={draft} />
        ) : (
          <p className="text-muted-foreground">
            No draft for this week. Trigger the chief manually or wait for Sunday&apos;s cron.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-xl">Latest signals</h2>
        <ul className="space-y-2 text-sm">
          {signals.map((s) => (
            <li key={s.id} className="rounded border border-border p-3">
              <div className="font-mono text-xs text-muted-foreground">
                {s.week_of} · {s.preflight_status}
              </div>
              <div className="mt-1">
                {s.rationale.slice(0, 240)}
                {s.rationale.length > 240 ? "…" : ""}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-xl">Brief history</h2>
        <ul className="space-y-2 text-sm">
          {history.map((b) => (
            <li key={b.id} className="rounded border border-border p-3">
              <div className="font-mono text-xs text-muted-foreground">
                {b.week_of} · {b.approval_status} · priority: {b.priority_channel}
              </div>
              <div className="mt-1">{b.audience_focus}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
