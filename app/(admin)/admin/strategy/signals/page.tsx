import { createServiceRoleClient } from "@/lib/supabase"
import { listSignals } from "@/lib/db/cross-channel-signals"

export const dynamic = "force-dynamic"

export default async function SignalsPage() {
  const sb = createServiceRoleClient()
  const signals = await listSignals(sb, 12)

  return (
    <div className="space-y-6 p-6">
      <h1 className="font-heading text-3xl">Cross-channel signals</h1>
      {signals.length === 0 && (
        <p className="text-muted-foreground">
          No signals yet. Run the critic manually from /admin/strategy.
        </p>
      )}
      <ul className="space-y-3">
        {signals.map((s) => (
          <li key={s.id} className="rounded border border-border p-4">
            <div className="font-mono text-xs text-muted-foreground">
              {s.week_of} · {s.preflight_status} · {new Date(s.created_at).toLocaleString()}
            </div>
            <h2 className="mt-2 font-heading">Recommendations for next brief</h2>
            <ul className="ml-4 list-disc text-sm">
              {(s.recommendations_for_brief as string[]).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <h2 className="mt-3 font-heading">Rationale</h2>
            <p className="whitespace-pre-wrap text-sm">{s.rationale}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
