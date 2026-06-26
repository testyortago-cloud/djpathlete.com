"use client"

import { useState } from "react"
import type { GoogleAdsCampaign } from "@/types/database"
import { AutomationModeSelector } from "./AutomationModeSelector"
import { CampaignBudgetEdit } from "./CampaignBudgetEdit"
import { CampaignNameEdit } from "./CampaignNameEdit"
import { CampaignStatusToggle } from "./CampaignStatusToggle"
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

export function CampaignsTable({ campaigns }: { campaigns: CampaignWithMetrics[] }) {
  const [showRemoved, setShowRemoved] = useState(false)

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

  // Removed campaigns can't be edited or revived from here — hide them by default
  // so the list shows only actionable campaigns, with an opt-in toggle.
  const removedCount = campaigns.filter((c) => c.status === "REMOVED").length
  const visible = showRemoved ? campaigns : campaigns.filter((c) => c.status !== "REMOVED")

  return (
    <div className="space-y-3">
      {removedCount > 0 && (
        <div className="flex items-center justify-end">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showRemoved}
              onChange={(e) => setShowRemoved(e.target.checked)}
              className="size-3.5 rounded border-border accent-primary"
            />
            Show removed ({removedCount})
          </label>
        </div>
      )}
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
        <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left p-3">Campaign</th>
            <th className="text-left p-3 w-28">Type</th>
            <th className="text-left p-3 w-24">Status</th>
            <th className="text-left p-3 w-28">Mode</th>
            <th className="text-right p-3 w-32">Budget</th>
            <th className="text-right p-3 w-28">Spend (7d)</th>
            <th className="text-right p-3 w-24">Clicks</th>
            <th className="text-right p-3 w-28">Conversions</th>
            <th className="text-right p-3 w-28">Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={9} className="p-8 text-center text-sm text-muted-foreground">
                All {removedCount} removed campaign{removedCount !== 1 ? "s" : ""} hidden — tick “Show removed” above to
                view.
              </td>
            </tr>
          ) : (
            visible.map((c) => (
            <tr key={c.id} className="border-t border-border/60 align-top">
              <td className="p-3">
                <CampaignNameEdit
                  campaignId={c.id}
                  customerId={c.customer_id}
                  externalCampaignId={c.campaign_id}
                  initialName={c.name}
                />
              </td>
              <td className="p-3 text-xs font-mono">{c.type}</td>
              <td className="p-3">
                <CampaignStatusToggle
                  campaignId={c.id}
                  campaignName={c.name}
                  initialStatus={c.status}
                />
              </td>
              <td className="p-3">
                <AutomationModeSelector
                  campaignId={c.id}
                  initialMode={c.automation_mode}
                  locked={c.type === "PERFORMANCE_MAX"}
                />
              </td>
              <td className="p-3 text-right">
                <CampaignBudgetEdit
                  campaignId={c.id}
                  campaignName={c.name}
                  initialBudgetMicros={c.budget_micros}
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
            ))
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}
