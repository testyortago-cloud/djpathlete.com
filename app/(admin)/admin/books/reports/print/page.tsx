import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments, listAssets } from "@/lib/db/bookkeeping"
import {
  incomeByServiceLine, profitAndLossByCategory, perBookSummary,
  type ProfitAndLoss,
} from "@/lib/bookkeeping/reports"
import { depreciationAsOf } from "@/lib/bookkeeping/depreciation"
import { stripeFeesInWindow } from "@/lib/bookkeeping/payout-fees"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import { presetRange } from "@/lib/bookkeeping/period"
import { PrintToolbar } from "@/components/admin/performance/print-toolbar"

export const metadata = { title: "Accountant pack | DJP Athlete" }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Shape-only regex accepts calendar-invalid values like 2026-13-01; round-trip
// through Date.UTC to reject those before they reach a Postgres date column.
function isValidIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const [y, m, d] = s.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

async function loadPrintData(from: string, to: string) {
  const [bundle, documents, assets] = await Promise.all([
    loadReportBundle(from, to),
    listAllDocuments(),
    listAssets(),
  ])
  const { books, accounts, entries } = bundle
  // ?? [] tolerates pre-payoutLines bundle doubles; the real bundle always supplies it.
  return { books, accounts, entries, payoutLines: bundle.payoutLines ?? [], documents, assets }
}

function PnlBlock({ pnl }: { pnl: ProfitAndLoss }) {
  return (
    <>
      {(["income", "expense"] as const).map((side) => (
        <table key={side} className="w-full border-collapse text-sm mb-3">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1 pr-4 font-medium">{side === "income" ? "Income" : "Expenses"}</th>
              <th className="py-1 pr-4 font-medium">Tax hint</th>
              <th className="py-1 pr-4 font-medium text-right">Entries</th>
              <th className="py-1 pr-4 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {pnl[side].length === 0 ? (
              <tr><td colSpan={4} className="py-1 text-sm">—</td></tr>
            ) : pnl[side].map((r) => (
              <tr key={r.account_id ?? "uncategorized"} className="border-b">
                <td className="py-1 pr-4">{r.name}</td>
                <td className="py-1 pr-4">{r.tax_category ?? "—"}</td>
                <td className="py-1 pr-4 text-right">{r.entry_count}</td>
                <td className="py-1 pr-4 text-right">{formatCents(r.total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <p className="text-sm font-semibold">
        Net (gross income − expenses): {formatCents(pnl.net_cents)}
      </p>
    </>
  )
}

export default async function AccountantPackPrintPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")

  const sp = await searchParams
  const today = new Date().toISOString().slice(0, 10)
  const fallback = presetRange("this_year", today)
  // A print surface should always render — invalid/missing dates fall back to this-year.
  const valid = sp.from && sp.to && isValidIsoDate(sp.from) && isValidIsoDate(sp.to) && sp.from <= sp.to && Number(sp.to.slice(0, 4)) - Number(sp.from.slice(0, 4)) <= 5
  let from = valid ? sp.from! : fallback.from
  let to = valid ? sp.to! : fallback.to

  let bundle
  try {
    bundle = await loadPrintData(from, to)
  } catch {
    // Belt and suspenders: any residual bad input (or a transient shape issue)
    // still renders this-year rather than crashing to the admin error boundary.
    // If the fallback window ALSO throws, that's a real outage — let it propagate.
    from = fallback.from
    to = fallback.to
    bundle = await loadPrintData(from, to)
  }
  const { books, accounts, entries, payoutLines, documents, assets } = bundle
  const stripeFees = stripeFeesInWindow(payoutLines, from, to)
  const summaries = perBookSummary(entries, books)
  const primary = books.find((b) => b.is_primary) ?? books[0]
  const bookName = new Map(books.map((b) => [b.id, b.name]))

  return (
    <div>
      <PrintToolbar />
      <div className="print-document mx-auto max-w-3xl bg-white text-black">
        <header className="mb-8 border-b pb-4">
          <p className="font-heading text-primary text-sm font-bold uppercase tracking-[0.2em]">DJP Athlete</p>
          <h1 className="font-heading mt-1 text-3xl font-bold">Accountant Pack</h1>
          <p className="mt-1 text-sm">
            Period {formatOccurredOn(from)} – {formatOccurredOn(to)} · Generated {formatOccurredOn(today)}
          </p>
          <p className="mt-2 text-xs">
            GROSS figures stay primary; Stripe processing fees from ingested payouts appear as a labeled net line (est.). Estimates for planning — the CPA files.
            A candidate for the accountant&apos;s review, never a filed return. Business and personal stay in separate books.
          </p>
        </header>

        <section className="mb-8">
          <h2 className="font-heading mb-3 text-lg font-semibold">Per-book summary</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1 pr-4 font-medium">Book</th>
                <th className="py-1 pr-4 font-medium">Kind</th>
                <th className="py-1 pr-4 font-medium text-right">Income</th>
                <th className="py-1 pr-4 font-medium text-right">Expenses</th>
                <th className="py-1 pr-4 font-medium text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.book_id} className="border-b">
                  <td className="py-1 pr-4">{s.name}</td>
                  <td className="py-1 pr-4">{s.book_kind}</td>
                  <td className="py-1 pr-4 text-right">{formatCents(s.income_cents)}</td>
                  <td className="py-1 pr-4 text-right">{formatCents(s.expense_cents)}</td>
                  <td className="py-1 pr-4 text-right">{formatCents(s.net_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {primary ? (
          <section className="mb-8">
            <h2 className="font-heading mb-3 text-lg font-semibold">Income by service — {primary.name}</h2>
            {(() => {
              const ibs = incomeByServiceLine(entries.filter((e) => e.book_id === primary.id), accounts)
              return ibs.rows.length === 0 ? (
                <p className="text-sm">No income recorded in this period.</p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {ibs.rows.map((r) => (
                      <tr key={r.service_line ?? "uncategorized"} className="border-b">
                        <td className="py-1 pr-4">{r.label}</td>
                        <td className="py-1 pr-4 text-right">{r.entry_count}</td>
                        <td className="py-1 pr-4 text-right">{formatCents(r.total_cents)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-1 pr-4 font-semibold">Total gross income</td>
                      <td />
                      <td className="py-1 pr-4 text-right font-semibold">{formatCents(ibs.total_cents)}</td>
                    </tr>
                    <tr>
                      <td className="py-1 pr-4">Stripe processing fees (est., from ingested payouts)</td>
                      <td />
                      <td className="py-1 pr-4 text-right">{stripeFees === 0 ? "$0.00 recorded" : `−${formatCents(stripeFees)}`}</td>
                    </tr>
                    <tr>
                      <td className="py-1 pr-4 font-semibold">Net income after Stripe fees (est.)</td>
                      <td />
                      <td className="py-1 pr-4 text-right font-semibold">{formatCents(ibs.total_cents - stripeFees)}</td>
                    </tr>
                  </tbody>
                </table>
              )
            })()}
          </section>
        ) : null}

        {books.map((book) => {
          const bookEntries = entries.filter((e) => e.book_id === book.id)
          return (
            <section key={book.id} className="mb-8">
              <h2 className="font-heading mb-3 text-lg font-semibold">P&amp;L — {book.owner_label ?? book.name}</h2>
              {bookEntries.length === 0 ? (
                <p className="text-sm">
                  No entries recorded for this period. This book exists to keep its finances separate — if it has no activity, it stays empty by design.
                </p>
              ) : (
                <PnlBlock pnl={profitAndLossByCategory(bookEntries, accounts)} />
              )}
            </section>
          )
        })}

        {assets.length > 0 ? (
          <section className="mb-8">
            <h2 className="font-heading mb-3 text-lg font-semibold">Depreciation register — {Number(to.slice(0, 4))}</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 pr-4 font-medium">Asset</th>
                  <th className="py-1 pr-4 font-medium">Book</th>
                  <th className="py-1 pr-4 font-medium">In service</th>
                  <th className="py-1 pr-4 font-medium text-right">Basis</th>
                  <th className="py-1 pr-4 font-medium text-right">Salvage</th>
                  <th className="py-1 pr-4 font-medium">Life</th>
                  <th className="py-1 pr-4 font-medium text-right">This year</th>
                  <th className="py-1 pr-4 font-medium text-right">Accumulated</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const asOf = depreciationAsOf(a, Number(to.slice(0, 4)))
                  return (
                    <tr key={a.id} className="border-b">
                      <td className="py-1 pr-4">{a.name}</td>
                      <td className="py-1 pr-4">{bookName.get(a.book_id) ?? "—"}</td>
                      <td className="py-1 pr-4">{formatOccurredOn(a.in_service_on)}</td>
                      <td className="py-1 pr-4 text-right">{formatCents(a.basis_cents)}</td>
                      <td className="py-1 pr-4 text-right">{formatCents(a.salvage_cents)}</td>
                      <td className="py-1 pr-4">{a.recovery_years} yr {a.convention === "half_year" ? "half-year" : "full-month"}</td>
                      <td className="py-1 pr-4 text-right">{formatCents(asOf.year_cents)}</td>
                      <td className="py-1 pr-4 text-right">{formatCents(asOf.accumulated_cents)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs">
              Depreciation is tracked, not decided — straight-line book depreciation from accountant-supplied basis, method, and life. For your CPA, not a filing.
            </p>
          </section>
        ) : null}

        <section className="mb-8">
          <h2 className="font-heading mb-3 text-lg font-semibold">Document index</h2>
          {documents.length === 0 ? (
            <p className="text-sm">No statements or receipts on file.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 pr-4 font-medium">Book</th>
                  <th className="py-1 pr-4 font-medium">Kind</th>
                  <th className="py-1 pr-4 font-medium">Filename</th>
                  <th className="py-1 pr-4 font-medium">Period</th>
                  <th className="py-1 pr-4 font-medium text-right">Posted</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id} className="border-b">
                    <td className="py-1 pr-4">{bookName.get(d.book_id) ?? "—"}</td>
                    <td className="py-1 pr-4">{d.kind}</td>
                    <td className="py-1 pr-4">{d.original_filename ?? "—"}</td>
                    <td className="py-1 pr-4">{d.period_start && d.period_end ? `${formatOccurredOn(d.period_start)} – ${formatOccurredOn(d.period_end)}` : "—"}</td>
                    <td className="py-1 pr-4 text-right">{d.posted_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
