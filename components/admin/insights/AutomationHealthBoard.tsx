"use client"

import { EXPECTED_CRONS } from "@/lib/automation/automation-health-scanner"

export interface HealthSnapshot {
  id: string
  snapshot_at: string
  ai_jobs_failed_24h: Record<string, number>
  ai_jobs_pending_over_1h: number
  silent_crons: Array<{
    cron_name: string
    last_success_at: string | null
    hours_since: number
    sla_hours: number
    severity: "warning" | "critical"
  }>
  alert_severity: "none" | "warning" | "critical"
  alert_summary: string | null
}

interface Props {
  snapshots: HealthSnapshot[]
  lastSuccessByCron: Record<string, string | null>
}

const SEV_BG: Record<HealthSnapshot["alert_severity"], string> = {
  none: "bg-emerald-100 text-emerald-900",
  warning: "bg-amber-100 text-amber-900",
  critical: "bg-red-100 text-red-900",
}

function lightFor(name: string, lastIso: string | null): "green" | "yellow" | "red" | "gray" {
  if (!lastIso) return "gray"
  const cron = EXPECTED_CRONS.find((c) => c.name === name)
  if (!cron) return "gray"
  const hoursSince = (Date.now() - new Date(lastIso).getTime()) / 3600_000
  if (hoursSince <= cron.sla_hours) return "green"
  if (hoursSince <= cron.sla_hours * 2) return "yellow"
  return "red"
}

const LIGHT_STYLE: Record<"green" | "yellow" | "red" | "gray", string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
  gray: "bg-gray-300",
}

export function AutomationHealthBoard({ snapshots, lastSuccessByCron }: Props) {
  const latest = snapshots[0]

  return (
    <div className="space-y-6">
      {latest ? (
        <div className={`rounded p-4 ${SEV_BG[latest.alert_severity]}`}>
          <p className="text-xs uppercase tracking-wider">
            Last scan · {new Date(latest.snapshot_at).toLocaleString()}
          </p>
          <p className="mt-1 font-heading text-lg uppercase">
            severity: {latest.alert_severity}
          </p>
          {latest.alert_summary && <p className="mt-1 text-sm">{latest.alert_summary}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No snapshots yet. The cron runs at 08:00 UTC.</p>
      )}

      <div>
        <h2 className="mb-2 font-heading text-sm uppercase tracking-wider text-muted-foreground">Cron traffic light</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {EXPECTED_CRONS.map((c) => {
            const last = lastSuccessByCron[c.name] ?? null
            const light = lightFor(c.name, last)
            return (
              <li key={c.name} className="flex items-center justify-between rounded border border-border p-3 text-sm">
                <span>
                  <span className={`mr-2 inline-block h-2 w-2 rounded-full ${LIGHT_STYLE[light]}`} />
                  <code className="font-mono">{c.name}</code>
                </span>
                <span className="text-xs text-muted-foreground">
                  SLA {c.sla_hours}h · {last ? new Date(last).toLocaleString() : "never"}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      {latest && Object.keys(latest.ai_jobs_failed_24h).length > 0 && (
        <div>
          <h2 className="mb-2 font-heading text-sm uppercase tracking-wider text-muted-foreground">AI jobs failed (24h)</h2>
          <ul className="space-y-1 text-sm">
            {Object.entries(latest.ai_jobs_failed_24h).map(([type, count]) => (
              <li key={type}>
                <code>{type}</code>: <strong>{count}</strong> failures
              </li>
            ))}
          </ul>
        </div>
      )}

      {latest && (
        <div className="text-sm">
          <span className="font-medium">AI jobs pending &gt; 1h:</span>{" "}
          <span className={latest.ai_jobs_pending_over_1h > 0 ? "text-red-700" : "text-emerald-700"}>
            {latest.ai_jobs_pending_over_1h}
          </span>
        </div>
      )}

      {snapshots.length > 1 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">History — last {snapshots.length} snapshots</summary>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {snapshots.map((s) => (
              <li key={s.id}>
                {new Date(s.snapshot_at).toLocaleString()} · {s.alert_severity}
                {s.alert_summary && ` — ${s.alert_summary}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
