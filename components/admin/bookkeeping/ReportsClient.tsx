"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, BarChart3, CalendarRange, Download, FileSpreadsheet, Lightbulb, Mail, Printer } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { EmailPackDialog } from "@/components/admin/bookkeeping/EmailPackDialog"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import { presetRange, PERIOD_PRESET_LABELS, type PeriodPreset } from "@/lib/bookkeeping/period"
import type { BookkeepingBook } from "@/types/database"
import type { IncomeByServiceLine, ProfitAndLoss, BookSummaryRow } from "@/lib/bookkeeping/reports"

interface BookReport {
  book: { id: string; name: string; book_kind: string; is_primary: boolean; currency: string }
  summary: BookSummaryRow
  income_by_service: IncomeByServiceLine
  pnl: ProfitAndLoss
  row_count: number
  stripe_fee_cents: number
  net_income_cents: number
}
interface ReportData { from: string; to: string; books: BookReport[] }

const QBO_LINE_CAP = 1000

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ReportsClient({
  books,
  emailPackEnabled,
  defaultAccountantEmail,
}: {
  books: BookkeepingBook[]
  emailPackEnabled: boolean
  defaultAccountantEmail: string
}) {
  const initial = presetRange("this_year", todayIso())
  const [preset, setPreset] = useState<PeriodPreset | "custom">("this_year")
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [bookId, setBookId] = useState(books.find((b) => b.is_primary)?.id ?? books[0]?.id ?? "")
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)
  const fetchRequestIdRef = useRef(0)

  const fetchReport = useCallback(async () => {
    const requestId = ++fetchRequestIdRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      const res = await fetch(`/api/admin/bookkeeping/reports?${params.toString()}`)
      if (!res.ok) throw new Error("failed")
      const body = (await res.json()) as ReportData
      if (requestId === fetchRequestIdRef.current) setData(body)
    } catch {
      if (requestId === fetchRequestIdRef.current) toast.error("Failed to load the report")
    } finally {
      if (requestId === fetchRequestIdRef.current) setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    void fetchReport()
  }, [fetchReport])

  const applyPreset = (value: string) => {
    if (value === "custom") { setPreset("custom"); return }
    const p = value as PeriodPreset
    const range = presetRange(p, todayIso())
    setPreset(p)
    setFrom(range.from)
    setTo(range.to)
  }

  if (books.length === 0) {
    return <EmptyState icon={BarChart3} heading="No books configured" description="No bookkeeping books exist yet. Seed the business book to get started." />
  }

  const totalEntries = data?.books.reduce((n, b) => n + b.row_count, 0) ?? 0
  const active = data?.books.find((b) => b.book.id === bookId)
  const qboDisabled = !active || active.row_count === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/books"
            className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-accent hover:text-accent"
          >
            <ArrowLeft className="size-4" />
            Back to Accounting
          </Link>
          <h1 className="text-2xl font-heading text-primary">Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gross figures stay primary; Stripe processing fees from ingested payouts appear as a labeled net line (est.). Estimates for planning; your CPA files.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/books/insights"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-accent hover:text-accent"
          >
            <Lightbulb className="size-4" />
            Insights
          </Link>
        </div>
      </div>

      {/* Period bar — labeled; raw dates only for a custom range */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Period</span>
            <select
              value={preset}
              onChange={(e) => applyPreset(e.currentTarget.value)}
              className="border-border bg-background rounded-md border px-3 py-2 text-sm"
            >
              {Object.entries(PERIOD_PRESET_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
              <option value="custom">Custom range…</option>
            </select>
          </label>
          {preset === "custom" && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">From</span>
                <input
                  type="date" value={from}
                  onChange={(e) => setFrom(e.currentTarget.value)}
                  className="border-border bg-background rounded-md border px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">To</span>
                <input
                  type="date" value={to}
                  onChange={(e) => setTo(e.currentTarget.value)}
                  className="border-border bg-background rounded-md border px-3 py-2 text-sm"
                />
              </label>
            </>
          )}
          <p className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarRange className="size-4" />
            {formatOccurredOn(from)} — {formatOccurredOn(to)}
          </p>
        </div>
      </div>

      {!loading && data && totalEntries === 0 ? (
        <EmptyState
          icon={BarChart3}
          heading="No posted entries in this period"
          description="Reports read the posted ledger. Post platform income, statements, or receipts first — or widen the period."
        />
      ) : (
        <>
          {/* All-books summary */}
          <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
            <h2 className="text-sm font-heading text-primary mb-3">Per-book summary</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="py-1 pr-4 font-medium">Book</th>
                  <th className="py-1 pr-4 font-medium">Income</th>
                  <th className="py-1 pr-4 font-medium">Expenses</th>
                  <th className="py-1 pr-4 font-medium">Net</th>
                  <th className="py-1 pr-4 font-medium">Entries</th>
                </tr>
              </thead>
              <tbody>
                {(data?.books ?? []).map(({ book, summary }) => (
                  <tr key={book.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-4">{book.name}</td>
                    <td className="py-1.5 pr-4 text-success">{formatCents(summary.income_cents)}</td>
                    <td className="py-1.5 pr-4 text-error">{formatCents(summary.expense_cents)}</td>
                    <td className={`py-1.5 pr-4 ${summary.net_cents >= 0 ? "text-success" : "text-error"}`}>{formatCents(summary.net_cents)}</td>
                    <td className="py-1.5 pr-4">{summary.entry_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Export row */}
          <div className="flex flex-wrap items-center gap-2">
            {qboDisabled ? (
              <Button size="sm" variant="outline" disabled>
                <Download className="size-4" />
                QuickBooks CSV
              </Button>
            ) : (
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/admin/bookkeeping/reports/quickbooks-csv?book_id=${bookId}&from=${from}&to=${to}`}>
                  <Download className="size-4" />
                  QuickBooks CSV
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/admin/bookkeeping/reports/accountant-pack?from=${from}&to=${to}`}>
                <FileSpreadsheet className="size-4" />
                Accountant pack (.xlsx)
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`/admin/books/reports/print?from=${from}&to=${to}`} target="_blank">
                <Printer className="size-4" />
                Print view
              </a>
            </Button>
            {emailPackEnabled ? (
              <Button size="sm" variant="outline" onClick={() => setEmailDialogOpen(true)}>
                <Mail className="size-4" />
                Email to accountant
              </Button>
            ) : null}
            {active && active.row_count > QBO_LINE_CAP ? (
              <p className="text-xs text-warning">
                QuickBooks caps CSV imports at {QBO_LINE_CAP.toLocaleString()} rows — this period has {active.row_count.toLocaleString()}. Consider exporting a shorter period.
              </p>
            ) : null}
          </div>

          {/* Per-book detail */}
          <Tabs value={bookId} onValueChange={setBookId}>
            <TabsList>
              {books.map((book) => (
                <TabsTrigger key={book.id} value={book.id}>{book.name}</TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={bookId} className="space-y-6 mt-4">
              {loading || !active ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  {/* Income by service */}
                  <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                    <h2 className="text-sm font-heading text-primary mb-3">Income by service line</h2>
                    {active.income_by_service.rows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No income in this period.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                            <th className="py-1 pr-4 font-medium">Service line</th>
                            <th className="py-1 pr-4 font-medium">Entries</th>
                            <th className="py-1 pr-4 font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {active.income_by_service.rows.map((r) => (
                            <tr key={r.service_line ?? "uncategorized"} className={`border-b last:border-0 ${r.service_line === null ? "bg-warning/10" : ""}`}>
                              <td className="py-1.5 pr-4">{r.label}</td>
                              <td className="py-1.5 pr-4">{r.entry_count}</td>
                              <td className="py-1.5 pr-4">{formatCents(r.total_cents)}</td>
                            </tr>
                          ))}
                          <tr>
                            <td className="py-1.5 pr-4 font-semibold">Total gross income</td>
                            <td />
                            <td className="py-1.5 pr-4 font-semibold">{formatCents(active.income_by_service.total_cents)}</td>
                          </tr>
                          {active.book.is_primary && active.book.book_kind === "business" ? (
                            <>
                              <tr>
                                <td className="py-1.5 pr-4 text-muted-foreground">Stripe processing fees (est., from ingested payouts)</td>
                                <td />
                                <td className="py-1.5 pr-4 text-muted-foreground">
                                  {active.stripe_fee_cents === 0 ? "$0.00 recorded" : `−${formatCents(active.stripe_fee_cents)}`}
                                </td>
                              </tr>
                              <tr>
                                <td className="py-1.5 pr-4 font-semibold">Net income after Stripe fees (est.)</td>
                                <td />
                                <td className="py-1.5 pr-4 font-semibold">{formatCents(active.net_income_cents)}</td>
                              </tr>
                            </>
                          ) : null}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* P&L */}
                  <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                    <h2 className="text-sm font-heading text-primary mb-3">Profit &amp; loss by category (gross)</h2>
                    {(["income", "expense"] as const).map((side) => (
                      <div key={side} className="mb-4">
                        <h3 className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{side === "income" ? "Income" : "Expenses"}</h3>
                        {active.pnl[side].length === 0 ? (
                          <p className="text-sm text-muted-foreground">None in this period.</p>
                        ) : (
                          <table className="w-full text-sm">
                            <tbody>
                              {active.pnl[side].map((r) => (
                                <tr key={r.account_id ?? "uncategorized"} className={`border-b last:border-0 ${r.account_id === null ? "bg-warning/10" : ""}`}>
                                  <td className="py-1.5 pr-4">{r.name}</td>
                                  <td className="py-1.5 pr-4 text-xs text-muted-foreground">{r.tax_category ?? ""}</td>
                                  <td className="py-1.5 pr-4 text-right">{r.entry_count}</td>
                                  <td className="py-1.5 pr-4 text-right">{formatCents(r.total_cents)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-6 border-t pt-3">
                      <p className="text-sm">Income <span className="font-semibold text-success">{formatCents(active.pnl.income_total_cents)}</span></p>
                      <p className="text-sm">Expenses <span className="font-semibold text-error">{formatCents(active.pnl.expense_total_cents)}</span></p>
                      <p className="text-sm">Net <span className={`font-semibold ${active.pnl.net_cents >= 0 ? "text-success" : "text-error"}`}>{formatCents(active.pnl.net_cents)}</span></p>
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      {emailPackEnabled ? (
        <EmailPackDialog
          open={emailDialogOpen}
          onOpenChange={setEmailDialogOpen}
          from={from}
          to={to}
          defaultRecipient={defaultAccountantEmail}
        />
      ) : null}
    </div>
  )
}
