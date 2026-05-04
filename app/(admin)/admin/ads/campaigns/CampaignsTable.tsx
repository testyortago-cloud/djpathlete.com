import type { GoogleAdsCampaign } from "@/types/database"
import { AutomationModeSelector } from "./AutomationModeSelector"
import { GenerateCopyButton } from "./GenerateCopyButton"

export interface CampaignWithMetrics extends GoogleAdsCampaign {
  cost_micros_7d: number
  clicks_7d: number
  conversions_7d: number
  conversion_value_7d: number
}

const CURRENCY_DIVISOR = 1_000_000

function fmtCurrencyMicros(micros: number): string {
  if (micros === 0) return "—"
  return `$${(micros / CURRENCY_DIVISOR).toFixed(2)}`
}

function fmtNumber(n: number): string {
  if (n === 0) return "—"
  return n.toLocaleString()
}

const STATUS_CLASSES: Record<GoogleAdsCampaign["status"], string> = {
  ENABLED: "bg-success/10 text-success",
  PAUSED: "bg-warning/15 text-warning",
  REMOVED: "bg-muted/40 text-muted-foreground",
}

export function CampaignsTable({ campaigns }: { campaigns: CampaignWithMetrics[] }) {
  if (campaigns.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-xl p-8 text-center bg-card">
        <p className="text-sm text-muted-foreground">
          No campaigns synced yet. Once your Developer Token is approved, click{" "}
          <span className="font-mono text-xs px-1 py-0.5 rounded bg-muted/40">Sync now</span> above
          (or wait for the 06:00 UTC nightly run).
        </p>
      </div>
    )
  }

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left p-3">Campaign</th>
            <th className="text-left p-3 w-28">Type</th>
            <th className="text-left p-3 w-24">Status</th>
            <th className="text-left p-3 w-28">Mode</th>
            <th className="text-right p-3 w-28">Spend (7d)</th>
            <th className="text-right p-3 w-24">Clicks</th>
            <th className="text-right p-3 w-28">Conversions</th>
            <th className="text-right p-3 w-28">Actions</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id} className="border-t border-border/60 align-top">
              <td className="p-3">
                <p className="font-medium text-primary leading-snug">{c.name}</p>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  {c.customer_id} · {c.campaign_id}
                </p>
              </td>
              <td className="p-3 text-xs font-mono">{c.type}</td>
              <td className="p-3">
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_CLASSES[c.status]}`}>
                  {c.status}
                </span>
              </td>
              <td className="p-3">
                <AutomationModeSelector
                  campaignId={c.id}
                  initialMode={c.automation_mode}
                  locked={c.type === "PERFORMANCE_MAX"}
                />
              </td>
              <td className="p-3 text-right font-mono text-xs">
                {fmtCurrencyMicros(c.cost_micros_7d)}
              </td>
              <td className="p-3 text-right font-mono text-xs">{fmtNumber(c.clicks_7d)}</td>
              <td className="p-3 text-right font-mono text-xs">
                {c.conversions_7d > 0 ? c.conversions_7d.toFixed(1) : "—"}
              </td>
              <td className="p-3 text-right">
                <GenerateCopyButton campaignId={c.id} disabled={c.type === "PERFORMANCE_MAX"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
