// app/(admin)/admin/insights/campaign-revenue/page.tsx — the campaign-to-revenue
// surface for the Lead Engine (Stage 1c, Task 9). Server component: reads
// `readCampaignRevenue` (lib/automation/campaign-revenue.ts, Task 7) and the
// business's own name, renders through the house `components/ui/data-table.tsx`
// standard — never a hand-rolled `<table>` (CLAUDE.md's /admin/team warning).
//
// `readCampaignRevenue` is deliberately NOT wrapped in try/catch. A failed read
// must not render as an empty report — zero won revenue and a broken query need
// to look different to whoever is looking at this page. Letting the error
// propagate sends it to app/(admin)/admin/error.tsx, the existing admin error
// boundary, which is visibly different from a table with zero rows. Same
// pattern as app/(admin)/admin/pipeline/page.tsx (Task 8).
//
// Window is "all time": `since` is the epoch, `until` is now. The pipeline
// schema (migration 00219) only just shipped, so there is no won revenue from
// before it existed — "all time" and "since launch" are the same range today.
// Per parent spec §7/§8, reporting starts at launch and there is nothing to
// back-fill; the first month's report is thin by design, not broken, and that
// is said explicitly below rather than left for someone to guess at.

import { requireAdmin } from "@/lib/auth-helpers"
import { getBusinessSettings } from "@/lib/db/businesses"
import { possessiveName } from "@/lib/lead-engine/business-copy"
import { readCampaignRevenue } from "@/lib/automation/campaign-revenue"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { formatCents } from "@/lib/bookkeeping/money"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
} from "@/components/ui/data-table"

export const metadata = { title: "Campaign Revenue | Insights | Admin" }
export const dynamic = "force-dynamic"

function utmCell(value: string | null) {
  return value ?? <span className="text-muted-foreground">—</span>
}

export default async function CampaignRevenuePage() {
  await requireAdmin()
  const { businessId } = await resolveAdminTenant()

  const until = new Date()
  const since = new Date(0)

  const [rows, business] = await Promise.all([
    readCampaignRevenue({ since, until, businessId }),
    getBusinessSettings(businessId),
  ])
  const name = possessiveName(business.display_name)

  // Campaign rows only, most valuable first — sort key is `wonValueCents`,
  // never row position. The unattributed bucket is located the same sound
  // way it must always be located: by `isUnattributed === true`, never by
  // `unattributedCount > 0` (that check returns `undefined` in the one case
  // — every deal attributed cleanly — that must stay visible as its own
  // zero row) and never by array position (`.at(-1)`, `.pop()`, etc. are not
  // a contract).
  const campaignRows = rows.filter((r) => !r.isUnattributed).sort((a, b) => b.wonValueCents - a.wonValueCents)
  const unattributedRow = rows.find((r) => r.isUnattributed)

  const totalWonCount = rows.reduce((sum, r) => sum + r.wonCount, 0)
  const totalWonValueCents = rows.reduce((sum, r) => sum + r.wonValueCents, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Campaign Revenue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every won deal in {name.inline} pipeline, traced back to the campaign that produced it via first-touch
          attribution. Revenue is read from the pipeline&rsquo;s own <code>value_cents</code>, never re-derived from
          payments, so this number and the board&rsquo;s number are the same number by construction.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Reporting starts the moment the Lead Engine pipeline launched — there is nothing earlier to back-fill. A thin
          first month is expected here, not a sign that anything is broken.
        </p>
      </div>

      <DataTableCard>
        <DataTableToolbar>
          <p className="text-sm text-muted-foreground">All won deals to date, grouped by campaign.</p>
        </DataTableToolbar>
        <DataTable>
          <DataTableHeader>
            <DataTableHead>Campaign</DataTableHead>
            <DataTableHead>Source</DataTableHead>
            <DataTableHead>Gclid</DataTableHead>
            <DataTableHead align="right">Won deals</DataTableHead>
            <DataTableHead align="right">Won value</DataTableHead>
          </DataTableHeader>
          <tbody>
            {rows.length === 0 ? (
              <DataTableEmpty colSpan={5}>
                No won deals yet. Reporting starts at launch — nothing to back-fill, so an empty report here is expected
                until the first deal closes.
              </DataTableEmpty>
            ) : (
              <>
                {campaignRows.map((row) => (
                  <DataTableRow key={JSON.stringify([row.utmCampaign, row.utmSource, row.gclid])}>
                    <DataTableCell className="font-medium">{utmCell(row.utmCampaign)}</DataTableCell>
                    <DataTableCell>{utmCell(row.utmSource)}</DataTableCell>
                    <DataTableCell>{utmCell(row.gclid)}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {row.wonCount}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono font-semibold text-success">
                      {formatCents(row.wonValueCents)}
                    </DataTableCell>
                  </DataTableRow>
                ))}
                {/* Always rendered, including when its counts are zero (every
                    deal in the window attributed cleanly). A hidden bucket is
                    how a partial report reads as a complete one — this row is
                    the whole point of the page, not an edge case to drop. */}
                {unattributedRow && (
                  <DataTableRow>
                    <DataTableCell>
                      <DataTableBadge tone="warning">Unattributed</DataTableBadge>
                      <p className="mt-1 text-xs text-muted-foreground">No first-touch match</p>
                    </DataTableCell>
                    <DataTableCell muted>—</DataTableCell>
                    <DataTableCell muted>—</DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {unattributedRow.wonCount}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono font-semibold">
                      {formatCents(unattributedRow.wonValueCents)}
                    </DataTableCell>
                  </DataTableRow>
                )}
              </>
            )}
          </tbody>
        </DataTable>
        {rows.length > 0 && (
          <DataTableFooter>
            <p className="text-xs text-muted-foreground">
              {campaignRows.length} campaign{campaignRows.length === 1 ? "" : "s"} · {totalWonCount} won deal
              {totalWonCount === 1 ? "" : "s"}
            </p>
            <p className="font-mono text-sm font-semibold text-primary">{formatCents(totalWonValueCents)} total</p>
          </DataTableFooter>
        )}
      </DataTableCard>
    </div>
  )
}
