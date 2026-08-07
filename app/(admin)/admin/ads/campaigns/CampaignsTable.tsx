"use client"

import {
  DataTable,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table"

import { Fragment, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { GoogleAdsCampaign } from "@/types/database"
import { AdGroupAdList, type AdGroupWithAds } from "./AdGroupAdList"
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

export function CampaignsTable({
  campaigns,
  adGroupsByCampaign,
}: {
  campaigns: CampaignWithMetrics[]
  adGroupsByCampaign: Record<string, AdGroupWithAds[]>
}) {
  const [showRemoved, setShowRemoved] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  if (campaigns.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-xl p-8 text-center bg-card">
        <p className="text-sm text-muted-foreground">
          No campaigns synced yet. Once your Developer Token is approved, click{" "}
          <span className="font-mono text-xs px-1 py-0.5 rounded bg-muted/40">Sync now</span> above (or wait for the
          06:00 UTC nightly run).
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
      <DataTableCard>
        <DataTable>
          <DataTableHeader>
            <DataTableHead>Campaign</DataTableHead>
            <DataTableHead className="w-28">Type</DataTableHead>
            <DataTableHead className="w-24">Status</DataTableHead>
            <DataTableHead className="w-28">Mode</DataTableHead>
            <DataTableHead align="right" className="w-32">
              Budget
            </DataTableHead>
            <DataTableHead align="right" className="w-28">
              Spend (7d)
            </DataTableHead>
            <DataTableHead align="right" className="w-24">
              Clicks
            </DataTableHead>
            <DataTableHead align="right" className="w-28">
              Conversions
            </DataTableHead>
            <DataTableHead align="right" className="w-28">
              Actions
            </DataTableHead>
          </DataTableHeader>
          <tbody>
            {visible.length === 0 ? (
              <DataTableEmpty colSpan={9}>
                All {removedCount} removed campaign{removedCount !== 1 ? "s" : ""} hidden — tick “Show removed” above to
                view.
              </DataTableEmpty>
            ) : (
              visible.map((c) => (
                <Fragment key={c.id}>
                  <DataTableRow className="align-top">
                    <DataTableCell>
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(c.id)}
                          aria-expanded={expanded.has(c.id)}
                          aria-label={`${expanded.has(c.id) ? "Hide" : "Show"} ad groups for ${c.name}`}
                          className="mt-1 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {expanded.has(c.id) ? (
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <CampaignNameEdit
                            campaignId={c.id}
                            customerId={c.customer_id}
                            externalCampaignId={c.campaign_id}
                            initialName={c.name}
                          />
                        </div>
                      </div>
                    </DataTableCell>
                    <DataTableCell className="font-mono text-xs">{c.type}</DataTableCell>
                    <DataTableCell>
                      <CampaignStatusToggle campaignId={c.id} campaignName={c.name} initialStatus={c.status} />
                    </DataTableCell>
                    <DataTableCell>
                      <AutomationModeSelector
                        campaignId={c.id}
                        initialMode={c.automation_mode}
                        locked={c.type === "PERFORMANCE_MAX"}
                      />
                    </DataTableCell>
                    <DataTableCell align="right">
                      <CampaignBudgetEdit
                        campaignId={c.id}
                        campaignName={c.name}
                        initialBudgetMicros={c.budget_micros}
                      />
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono text-xs">
                      {fmtCurrencyMicros(c.cost_micros_7d)}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono text-xs">
                      {fmtNumber(c.clicks_7d)}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono text-xs">
                      {c.conversions_7d > 0 ? c.conversions_7d.toFixed(1) : "—"}
                    </DataTableCell>
                    <DataTableCell align="right">
                      <GenerateCopyButton campaignId={c.id} disabled={c.type === "PERFORMANCE_MAX"} />
                    </DataTableCell>
                  </DataTableRow>
                  {expanded.has(c.id) && (
                    // Continuation panel for the row above — no hover tint, since it
                    // isn't a row of its own.
                    <tr className="border-b border-border last:border-b-0">
                      <td colSpan={9} className="p-0">
                        <div className="px-6 py-3 bg-surface/40">
                          <AdGroupAdList adGroups={adGroupsByCampaign[c.id] ?? []} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </DataTable>
      </DataTableCard>
    </div>
  )
}
