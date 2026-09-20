// app/(admin)/admin/insights/campaign-revenue/page.tsx — the campaign-to-revenue
// surface for the Lead Engine (Stage 1c, Task 9). Server component: reads
// `readCampaignRevenue` (lib/automation/campaign-revenue.ts, Task 7) and the
// business's own name, renders through the house `components/ui/data-table.tsx`
// standard — never a hand-rolled `<table>` (CLAUDE.md's /admin/team warning).
//
// `readCampaignRevenue` is deliberately NOT wrapped in try/catch. A failed read
// must not render as an empty report — zero revenue and a broken query need to
// look different to whoever is looking at this page. Letting the error
// propagate sends it to app/(admin)/admin/error.tsx, the existing admin error
// boundary, which is visibly different from a table with zero rows. Same
// pattern as app/(admin)/admin/pipeline/page.tsx (Task 8).
//
// SINCE G15 THE PAGE REPORTS FOUR NUMBERS, NOT ONE. It used to show won deals
// only, which on this account is two rows against 572 sessions — so a campaign
// nobody clicked looked exactly like a campaign with forty leads and no sale
// yet. Leads and registrations are the two that move week to week, and they are
// what makes the page worth opening before the first deal closes.
//
// THE WINDOW IS NOW A CHOICE, and it lives in the URL rather than in component
// state so a filtered view is a link — the same reason
// app/(admin)/admin/funnels/leads/page.tsx does it. "All time" stays the
// default: the pipeline schema (migration 00219) has not been live long, so for
// this account it is still the widest honest answer.

import Link from "next/link"
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

const DAY_MS = 86_400_000

/**
 * The windows this page offers, and the ONLY values `?days=` accepts.
 *
 * A closed set rather than a parsed number, for the reason
 * `parseContactFilters` spells out: `new Date(Date.now() - NaN)` is an Invalid
 * Date and `.toISOString()` on one THROWS, so an unvalidated day count means a
 * hand-edited URL renders the admin error boundary instead of a report.
 */
const WINDOWS = [
  { value: "", label: "All time", days: null as number | null },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
] as const

function utmCell(value: string | null) {
  return value ?? <span className="text-muted-foreground">—</span>
}

export default async function CampaignRevenuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()
  const { businessId } = await resolveAdminTenant()

  const params = await searchParams
  const rawDays = params.days
  const requested = (Array.isArray(rawDays) ? rawDays[0] : rawDays) ?? ""
  // An unrecognised value falls back to All time rather than being rejected: a
  // junk window has an obvious right answer, and a report is not worth an error
  // page over a mistyped query string.
  const chosen = WINDOWS.find((w) => w.value === requested) ?? WINDOWS[0]

  const until = new Date()
  const since = chosen.days === null ? new Date(0) : new Date(until.getTime() - chosen.days * DAY_MS)

  const [rows, business] = await Promise.all([
    readCampaignRevenue({ since, until, businessId }),
    getBusinessSettings(businessId),
  ])
  const name = possessiveName(business.display_name)

  // Campaign rows only, most valuable first. Sorted by won value and then by
  // LEADS, because before the first deal closes every row's value is zero and
  // an unsorted list of them is in whatever order the grouping happened to
  // produce — which is the state this account is actually in.
  //
  // The unattributed bucket is located the same sound way it must always be
  // located: by `isUnattributed === true`, never by `unattributedCount > 0`
  // (that check returns `undefined` in the one case — everything attributed
  // cleanly — that must stay visible as its own zero row) and never by array
  // position (`.at(-1)`, `.pop()`, etc. are not a contract).
  const campaignRows = rows
    .filter((r) => !r.isUnattributed)
    .sort((a, b) => b.wonValueCents - a.wonValueCents || b.leadCount - a.leadCount)
  const unattributedRow = rows.find((r) => r.isUnattributed)

  const totals = rows.reduce(
    (sum, r) => ({
      leads: sum.leads + r.leadCount,
      registrations: sum.registrations + r.registrationCount,
      won: sum.won + r.wonCount,
      value: sum.value + r.wonValueCents,
    }),
    { leads: 0, registrations: 0, won: 0, value: 0 },
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Campaign Revenue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What each campaign actually produced for {name.inline} business, traced back through first-touch attribution.
          Revenue is read from the pipeline&rsquo;s own <code>value_cents</code>, never re-derived from payments, so
          this number and the board&rsquo;s number are the same number by construction.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          <strong>Leads</strong> are people whose first visit came from that campaign. <strong>Registrations</strong>{" "}
          are the ones who went on to ask about something or pay for a place — whether or not it turned into a sale.{" "}
          <strong>Won deals</strong> counts by the day a deal closed, so a deal can be one month&rsquo;s registration
          and another month&rsquo;s revenue.
        </p>
      </div>

      <DataTableCard>
        <DataTableToolbar className="flex-wrap gap-2">
          <p className="flex-1 text-sm text-muted-foreground">{chosen.label}, grouped by campaign.</p>
          {/* Links, not a <select>: this is a server component, a filtered view
              should be shareable, and a form here would need a client island to
              do something a href already does. */}
          <div className="flex gap-1">
            {WINDOWS.map((window) => (
              <Link
                key={window.value || "all"}
                href={window.value ? `?days=${window.value}` : "?"}
                aria-current={window.value === chosen.value ? "page" : undefined}
                className={
                  window.value === chosen.value
                    ? "rounded-lg border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"
                    : "rounded-lg border border-border bg-white px-3 py-1.5 text-sm text-muted-foreground hover:text-primary"
                }
              >
                {window.label}
              </Link>
            ))}
          </div>
        </DataTableToolbar>
        <DataTable>
          <DataTableHeader>
            <DataTableHead>Campaign</DataTableHead>
            <DataTableHead>Source</DataTableHead>
            {/* THE CLICK ID STAYS A COLUMN because it is still part of the
                grouping key. Dropping it while the key kept it is how a
                gclid-only paid click — no utm parameters at all, which is what
                a plain Google Ads text ad produces — renders as several
                identical "— / —" rows that a reader cannot tell apart. The
                `gclid` field comment in the DAL records that exact bug being
                fixed once already. */}
            <DataTableHead>Click id</DataTableHead>
            <DataTableHead align="right">Leads</DataTableHead>
            <DataTableHead align="right">Registrations</DataTableHead>
            <DataTableHead align="right">Won deals</DataTableHead>
            <DataTableHead align="right">Won value</DataTableHead>
          </DataTableHeader>
          <tbody>
            {rows.length === 0 ? (
              <DataTableEmpty colSpan={7}>
                Nothing in this window yet — no leads, no enquiries, no deals. Reporting starts at launch, so an empty
                report here is expected rather than a sign that something is broken.
              </DataTableEmpty>
            ) : (
              <>
                {campaignRows.map((row) => (
                  <DataTableRow key={JSON.stringify([row.utmCampaign, row.utmSource, row.gclid, row.landingSlug])}>
                    <DataTableCell className="font-medium">
                      {/* A FUNNEL LANDING IS NAMED, not left as three em-dashes.
                          These are sessions that arrived on a page the coach
                          built with no campaign tag on the link — the biggest
                          single group on this account, and useless while it sat
                          inside "Unattributed". */}
                      {row.landingSlug ? (
                        <>
                          {row.landingSlug}
                          <p className="mt-1 text-xs text-muted-foreground">Funnel page, no campaign tag</p>
                        </>
                      ) : (
                        utmCell(row.utmCampaign)
                      )}
                    </DataTableCell>
                    <DataTableCell>
                      {row.landingSlug ? <span className="text-muted-foreground">Direct</span> : utmCell(row.utmSource)}
                    </DataTableCell>
                    <DataTableCell className="max-w-[12rem] truncate font-mono text-xs">
                      {row.landingSlug ? <span className="text-muted-foreground">—</span> : utmCell(row.gclid)}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {row.leadCount}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {row.registrationCount}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {row.wonCount}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono font-semibold text-success">
                      {formatCents(row.wonValueCents)}
                    </DataTableCell>
                  </DataTableRow>
                ))}
                {/* Always rendered, including when its counts are zero
                    (everything in the window attributed cleanly). A hidden
                    bucket is how a partial report reads as a complete one —
                    this row is the whole point of the page, not an edge case
                    to drop. */}
                {unattributedRow && (
                  <DataTableRow>
                    <DataTableCell>
                      <DataTableBadge tone="warning">Unattributed</DataTableBadge>
                      <p className="mt-1 text-xs text-muted-foreground">No first-touch match</p>
                    </DataTableCell>
                    <DataTableCell muted>—</DataTableCell>
                    <DataTableCell muted>—</DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {unattributedRow.leadCount}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {unattributedRow.registrationCount}
                    </DataTableCell>
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
              {campaignRows.length} campaign{campaignRows.length === 1 ? "" : "s"} · {totals.leads} lead
              {totals.leads === 1 ? "" : "s"} · {totals.registrations} registration
              {totals.registrations === 1 ? "" : "s"} · {totals.won} won deal{totals.won === 1 ? "" : "s"}
            </p>
            <p className="font-mono text-sm font-semibold text-primary">{formatCents(totals.value)} total</p>
          </DataTableFooter>
        )}
      </DataTableCard>
    </div>
  )
}
