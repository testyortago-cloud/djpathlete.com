import Link from "next/link"
import { listRecentAutomationLog } from "@/lib/db/google-ads-automation-log"

export const metadata = { title: "Google Ads — Automation Log" }
export const dynamic = "force-dynamic"

const RESULT_TONE: Record<string, string> = {
  success: "bg-success/10 text-success",
  failure: "bg-error/10 text-error",
  partial: "bg-warning/15 text-warning",
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return "just now"
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

function summarizeRequest(req: Record<string, unknown> | null): string {
  if (!req) return "—"
  if ("ops" in req && Array.isArray((req as { ops: unknown[] }).ops)) {
    const ops = (req as { ops: Array<{ entity?: string; operation?: string }> }).ops
    return ops
      .map((o) => `${o.operation ?? "?"} ${o.entity ?? "?"}`)
      .join(", ")
  }
  if ("rec_type" in req) {
    return String((req as { rec_type: unknown }).rec_type)
  }
  return JSON.stringify(req).slice(0, 80)
}

export default async function AutomationLogPage() {
  const entries = await listRecentAutomationLog(100)

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-heading text-primary">Automation Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Audit trail for every Google Ads mutation we attempt. Both successful and failed apply
          attempts are recorded with the request payload and Google's response. Newest first.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-8 text-center bg-card">
          <p className="text-sm text-muted-foreground">
            No applies yet. Recommendations apply automatically in auto-pilot mode (negative
            keywords with confidence ≥ 0.8) or manually via the{" "}
            <Link href="/admin/ads/recommendations" className="underline hover:text-accent">
              recommendations queue
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3 w-24">When</th>
                <th className="text-left p-3 w-24">Result</th>
                <th className="text-left p-3 w-28">Mode</th>
                <th className="text-left p-3 w-28">Actor</th>
                <th className="text-left p-3">Mutation</th>
                <th className="text-left p-3">Customer</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-border/60 align-top">
                  <td
                    className="p-3 font-mono text-xs text-muted-foreground"
                    title={new Date(e.created_at).toLocaleString()}
                  >
                    {relativeTime(e.created_at)}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs ${RESULT_TONE[e.result_status] ?? "bg-muted/40 text-muted-foreground"}`}
                    >
                      {e.result_status}
                    </span>
                  </td>
                  <td className="p-3 text-xs">{e.mode}</td>
                  <td className="p-3 text-xs font-mono">
                    {e.actor === "system" ? "system" : `${e.actor.slice(0, 8)}…`}
                  </td>
                  <td className="p-3 text-xs">
                    <p>{summarizeRequest(e.api_request)}</p>
                    {e.error_message ? (
                      <p className="text-error text-[11px] mt-1 leading-snug">
                        {e.error_message.slice(0, 200)}
                      </p>
                    ) : null}
                  </td>
                  <td className="p-3 font-mono text-xs">{e.customer_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
