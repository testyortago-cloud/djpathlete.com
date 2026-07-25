"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft, BarChart3, CalendarRange, Lightbulb, X } from "lucide-react"
import { toast } from "sonner"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import type { DeductionFindings, HomeOfficeCandidate } from "@/lib/bookkeeping/deduction-finder"
import { findingFingerprint } from "@/lib/bookkeeping/finding-fingerprint"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import { PERIOD_PRESET_LABELS, presetRange, type PeriodPreset } from "@/lib/bookkeeping/period"
import type { WatchdogFinding } from "@/lib/bookkeeping/receipt-watchdog"
import type { ServiceLineProfit } from "@/lib/bookkeeping/service-line-profit"
import type { TaxForecast } from "@/lib/bookkeeping/tax-forecast"
import type { VendorSweep } from "@/lib/bookkeeping/vendor-sweep"
import type { YearEndFlag } from "@/lib/bookkeeping/year-end-flags"
import type { BookkeepingBook } from "@/types/database"

interface BookInsights {
  book: { id: string; name: string; book_kind: string; is_primary: boolean; currency: string }
  deductions: DeductionFindings
  profit: ServiceLineProfit
  vendors: VendorSweep
  row_count: number
  dismissed_fingerprints: string[]
}
interface ForecastBookRow {
  book_id: string
  book_name: string
  forecast: TaxForecast
}
interface InsightsData {
  from: string
  to: string
  home_office_percent: number | null
  books: BookInsights[]
  home_office: HomeOfficeCandidate
  year_end_flags: YearEndFlag[]
  forecast: { ytd_from: string; ytd_to: string; rate_percent: number | null; books: ForecastBookRow[] }
  watchdog: WatchdogFinding[]
}

const VISIBLE_ROW_CAP = 25

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function ReceiptDot({ present }: { present: boolean }) {
  return (
    <span
      className={`inline-block size-2 rounded-full ${present ? "bg-success" : "bg-muted"}`}
      title={present ? "Receipt attached" : "No receipt attached"}
    />
  )
}

function partitionDismissed<T>(rows: T[], dismissed: (row: T) => boolean): { visible: T[]; hidden: T[] } {
  const visible: T[] = []
  const hidden: T[] = []
  for (const row of rows) (dismissed(row) ? hidden : visible).push(row)
  return { visible, hidden }
}

function DismissButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="text-muted-foreground transition-colors hover:text-error"
    >
      <X className="size-3.5" />
    </button>
  )
}

/** Collapsed dismissed rows: compact summary lines + a Restore button each. */
function DismissedReveal({
  count,
  open,
  onToggle,
  children,
}: {
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  if (count === 0) return null
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        {count} dismissed — {open ? "hide" : "show"}
      </button>
      {open ? <div className="mt-2 space-y-1 opacity-70">{children}</div> : null}
    </div>
  )
}

/** Compact restore line inside a DismissedReveal. */
function RestoreRow({ label, onRestore }: { label: string; onRestore: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <button type="button" className="text-xs underline-offset-4 hover:underline" onClick={onRestore}>
        Restore
      </button>
    </div>
  )
}

export function InsightsClient({
  books,
  initialHomeOfficePercent,
}: {
  books: BookkeepingBook[]
  initialHomeOfficePercent: number | null
}) {
  const initial = presetRange("this_year", todayIso())
  const [preset, setPreset] = useState<PeriodPreset | "custom">("this_year")
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [bookId, setBookId] = useState(books.find((b) => b.is_primary)?.id ?? books[0]?.id ?? "")
  const [percentInput, setPercentInput] = useState(initialHomeOfficePercent?.toString() ?? "")
  const [savingPercent, setSavingPercent] = useState(false)
  const [rateInput, setRateInput] = useState("")
  const [savingRate, setSavingRate] = useState(false)
  const fetchRequestIdRef = useRef(0)

  // Dismissals (5b): optimistic overrides keyed `${bookId}|${fingerprint}`,
  // cleared whenever a fresh GET lands (server truth wins). Reveal open-state
  // is per card key.
  const [dismissOverrides, setDismissOverrides] = useState<Record<string, "dismissed" | "active">>({})
  const [revealOpen, setRevealOpen] = useState<Record<string, boolean>>({})

  const setDismissed = useCallback(async (rowBookId: string, fingerprint: string, dismissed: boolean) => {
    const key = `${rowBookId}|${fingerprint}`
    setDismissOverrides((o) => ({ ...o, [key]: dismissed ? "dismissed" : "active" }))
    try {
      const res = await fetch("/api/admin/bookkeeping/insights/dismissals", {
        method: dismissed ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: rowBookId, fingerprint }),
      })
      if (!res.ok) throw new Error("failed")
    } catch {
      setDismissOverrides((o) => ({ ...o, [key]: dismissed ? "active" : "dismissed" }))
      toast.error(dismissed ? "Failed to dismiss the finding" : "Failed to restore the finding")
    }
  }, [])

  const fetchInsights = useCallback(async () => {
    const requestId = ++fetchRequestIdRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      const res = await fetch(`/api/admin/bookkeeping/insights?${params.toString()}`)
      if (!res.ok) throw new Error("failed")
      const body = (await res.json()) as InsightsData
      if (requestId === fetchRequestIdRef.current) {
        setData(body)
        // Server truth wins: a landed refetch retires every optimistic override.
        setDismissOverrides({})
        setPercentInput(body.home_office_percent?.toString() ?? "")
        setRateInput(body.forecast.rate_percent?.toString() ?? "")
      }
    } catch {
      if (requestId === fetchRequestIdRef.current) toast.error("Failed to load insights")
    } finally {
      if (requestId === fetchRequestIdRef.current) setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    void fetchInsights()
  }, [fetchInsights])

  const applyPreset = (value: string) => {
    if (value === "custom") {
      setPreset("custom")
      return
    }
    const p = value as PeriodPreset
    const range = presetRange(p, todayIso())
    setPreset(p)
    setFrom(range.from)
    setTo(range.to)
  }

  const savePercent = useCallback(
    async (value: number | null) => {
      setSavingPercent(true)
      try {
        const res = await fetch("/api/admin/bookkeeping/insights/home-office", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ percent: value }),
        })
        if (!res.ok) throw new Error("failed")
        toast.success(value === null ? "Office share cleared" : "Office share saved")
        void fetchInsights()
      } catch {
        toast.error("Failed to save the office share")
      } finally {
        setSavingPercent(false)
      }
    },
    [fetchInsights],
  )

  const handleSavePercent = () => {
    const parsed = Number(percentInput)
    if (!Number.isFinite(parsed) || parsed < 0.01 || parsed > 100) {
      toast.error("Enter a percent between 0.01 and 100")
      return
    }
    void savePercent(Math.round(parsed * 100) / 100)
  }

  const saveRate = useCallback(
    async (value: number | null) => {
      setSavingRate(true)
      try {
        const res = await fetch("/api/admin/bookkeeping/insights/tax-rate", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ percent: value }),
        })
        if (!res.ok) throw new Error("failed")
        toast.success(value === null ? "Tax rate cleared" : "Tax rate saved")
        void fetchInsights()
      } catch {
        toast.error("Failed to save the tax rate")
      } finally {
        setSavingRate(false)
      }
    },
    [fetchInsights],
  )

  const handleSaveRate = () => {
    const parsed = Number(rateInput)
    if (!Number.isFinite(parsed) || parsed < 0.01 || parsed > 100) {
      toast.error("Enter a percent between 0.01 and 100")
      return
    }
    void saveRate(Math.round(parsed * 100) / 100)
  }

  if (books.length === 0) {
    return (
      <EmptyState
        icon={Lightbulb}
        heading="No books configured"
        description="No bookkeeping books exist yet. Seed the business book to get started."
      />
    )
  }

  const totalEntries = data?.books.reduce((n, b) => n + b.row_count, 0) ?? 0
  const active = data?.books.find((b) => b.book.id === bookId)
  const targetBook = data ? books.find((b) => b.id === data.home_office.target_book_id) : undefined
  const targetCurrency = targetBook?.currency ?? "usd"
  const watchdogRows = data && active ? data.watchdog.filter((f) => f.book_id === active.book.id) : []
  const forecastForBook =
    data && active ? (data.forecast.books.find((f) => f.book_id === active.book.id) ?? null) : null

  // Dismissal partitions (5b). Card headline chips keep the FULL recompute
  // totals — dismissals collapse rows, they never alter computed numbers.
  const isDismissed = (rowBookId: string, fingerprint: string, serverList: string[]) => {
    const override = dismissOverrides[`${rowBookId}|${fingerprint}`]
    if (override) return override === "dismissed"
    return serverList.includes(fingerprint)
  }
  const activeDismissed = active?.dismissed_fingerprints ?? []
  const activeBookId = active?.book.id ?? ""
  const watchlistParts = partitionDismissed(active?.deductions.watchlist ?? [], (w) =>
    isDismissed(activeBookId, findingFingerprint("watchlist", w.account_id), activeDismissed),
  )
  const gapParts = partitionDismissed(active?.deductions.substantiation_gaps ?? [], (g) =>
    isDismissed(activeBookId, findingFingerprint("substantiation_gap", g.entry_id), activeDismissed),
  )
  const uncatParts = partitionDismissed(active?.deductions.uncategorized.entries ?? [], (u) =>
    isDismissed(activeBookId, findingFingerprint("uncategorized", u.entry_id), activeDismissed),
  )
  const vendorParts = partitionDismissed(active?.vendors.recurring ?? [], (v) =>
    isDismissed(activeBookId, findingFingerprint("vendor", v.key), activeDismissed),
  )
  const watchdogParts = partitionDismissed(watchdogRows, (f) =>
    isDismissed(activeBookId, findingFingerprint("watchdog", f.entry_id), activeDismissed),
  )
  // Year-end flags are cross-book: dismissals scope to the primary book.
  const primaryPayload = data?.books.find((b) => b.book.is_primary) ?? data?.books[0]
  const flagParts = partitionDismissed(data?.year_end_flags ?? [], (flag) =>
    primaryPayload
      ? isDismissed(
          primaryPayload.book.id,
          findingFingerprint("year_end", flag.id),
          primaryPayload.dismissed_fingerprints ?? [],
        )
      : false,
  )

  const homeOfficeCard = data ? (
    <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
      <h2 className="text-sm font-heading text-primary mb-3">Home-office allocation</h2>
      {data.home_office.inputs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matched household rent/utility accounts found.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
              <th className="py-1 pr-4 font-medium">Account</th>
              <th className="py-1 pr-4 font-medium">Total</th>
              <th className="py-1 pr-4 font-medium">Proposed share</th>
            </tr>
          </thead>
          <tbody>
            {data.home_office.inputs.map((input) => (
              <tr key={input.account_id} className="border-b last:border-0">
                <td className="py-1.5 pr-4">{input.name}</td>
                <td className="py-1.5 pr-4">{formatCents(input.total_cents, targetCurrency)}</td>
                <td className="py-1.5 pr-4">
                  {input.proposed_cents === null ? "—" : formatCents(input.proposed_cents, targetCurrency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap gap-6 border-t pt-3 mt-3">
        <p className="text-sm">
          Input total <span className="font-semibold">{formatCents(data.home_office.input_total_cents, targetCurrency)}</span>
        </p>
        <p className="text-sm">
          Proposed total{" "}
          <span className="font-semibold">
            {data.home_office.proposed_total_cents === null
              ? "—"
              : formatCents(data.home_office.proposed_total_cents, targetCurrency)}
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <input
          type="number"
          min={0.01}
          max={100}
          step={0.01}
          value={percentInput}
          onChange={(e) => setPercentInput(e.currentTarget.value)}
          disabled={savingPercent}
          className="border-border rounded-md border px-3 py-2 text-sm w-28"
          aria-label="Office share percent"
        />
        <Button size="sm" disabled={savingPercent} onClick={handleSavePercent}>
          Save
        </Button>
        <Button size="sm" variant="outline" disabled={savingPercent} onClick={() => void savePercent(null)}>
          Clear
        </Button>
      </div>

      {data.home_office.percent === null ? (
        <p className="text-xs text-muted-foreground mt-2">Enter your office share % — your CPA confirms the method.</p>
      ) : null}

      {data.home_office.excluded_household_expense_cents > 0 ? (
        <p className="text-xs text-muted-foreground mt-2">
          Other household spending excluded from this proposal: {formatCents(data.home_office.excluded_household_expense_cents, targetCurrency)}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground mt-3 border-t pt-3">
        This is a proposal on the business book&apos;s screen, not an entry — business and household books stay separate. Your CPA sets the
        method (simplified vs actual) and the final percentage.
      </p>
    </div>
  ) : null

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
          <h1 className="text-2xl font-heading text-primary">Insights</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every finding on this page is a candidate for your accountant to confirm — never a filed decision. Dollar figures are estimates;
            your CPA files.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/books/reports"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-accent hover:text-accent"
          >
            <BarChart3 className="size-4" />
            Reports
          </Link>
        </div>
      </div>

      {/* Period bar — labeled card; raw dates only for a custom range */}
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
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              <option value="custom">Custom range…</option>
            </select>
          </label>
          {preset === "custom" && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">From</span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.currentTarget.value)}
                  className="border-border bg-background rounded-md border px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">To</span>
                <input
                  type="date"
                  value={to}
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

      {/* Year-end flags strip */}
      {data && data.year_end_flags.length > 0 && primaryPayload ? (
        <div className="space-y-2">
          {flagParts.visible.map((flag) => (
            <div key={flag.id} className="rounded-lg border border-border bg-primary/5 p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-primary">{flag.title}</p>
                <DismissButton
                  label={`Dismiss flag: ${flag.title}`}
                  onClick={() =>
                    void setDismissed(primaryPayload.book.id, findingFingerprint("year_end", flag.id), true)
                  }
                />
              </div>
              <p className="text-muted-foreground">{flag.detail}</p>
            </div>
          ))}
          <DismissedReveal
            count={flagParts.hidden.length}
            open={revealOpen["year_end"] ?? false}
            onToggle={() => setRevealOpen((r) => ({ ...r, year_end: !r.year_end }))}
          >
            {flagParts.hidden.map((flag) => (
              <RestoreRow
                key={flag.id}
                label={flag.title}
                onRestore={() =>
                  void setDismissed(primaryPayload.book.id, findingFingerprint("year_end", flag.id), false)
                }
              />
            ))}
          </DismissedReveal>
        </div>
      ) : null}

      {!loading && data && totalEntries === 0 ? (
        <>
          <EmptyState
            icon={Lightbulb}
            heading="No posted entries in this period"
            description="Insights read the posted ledger. Post platform income, statements, or receipts first — or widen the period."
          />
          {homeOfficeCard}
        </>
      ) : (
        <Tabs value={bookId} onValueChange={setBookId}>
          <TabsList>
            {books.map((book) => (
              <TabsTrigger key={book.id} value={book.id}>
                {book.name}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={bookId} className="space-y-6 mt-4">
            {loading || !active ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                {/* Deduction watchlist */}
                <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                  <h2 className="text-sm font-heading text-primary mb-1">Deduction watchlist</h2>
                  <p className="text-xs text-muted-foreground mb-3">Candidate deductions — your accountant confirms.</p>
                  {active.deductions.watchlist.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No deductible-candidate categories configured.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                          <th className="py-1 pr-4 font-medium">Category</th>
                          <th className="py-1 pr-4 font-medium">Total</th>
                          <th className="py-1 pr-4 font-medium">Entries</th>
                          <th className="py-1 pr-4 font-medium">Top counterparties</th>
                          <th className="py-1" />
                        </tr>
                      </thead>
                      <tbody>
                        {watchlistParts.visible.map((w) => (
                          <tr key={w.account_id} className="border-b last:border-0">
                            <td className="py-1.5 pr-4">
                              {w.name}
                              {w.archived ? (
                                <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                  archived
                                </span>
                              ) : null}
                            </td>
                            <td className="py-1.5 pr-4">{formatCents(w.total_cents, active.book.currency)}</td>
                            <td className="py-1.5 pr-4">{w.entry_count}</td>
                            <td className="py-1.5 pr-4 text-xs text-muted-foreground">
                              {w.top_counterparties
                                .map((c) => `${c.counterparty ?? "—"} ${formatCents(c.total_cents, active.book.currency)}`)
                                .join(" · ")}
                            </td>
                            <td className="py-1.5">
                              <DismissButton
                                label={`Dismiss watchlist row: ${w.name}`}
                                onClick={() =>
                                  void setDismissed(
                                    active.book.id,
                                    findingFingerprint("watchlist", w.account_id),
                                    true,
                                  )
                                }
                              />
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td className="py-1.5 pr-4 font-semibold">Watchlist total</td>
                          <td className="py-1.5 pr-4 font-semibold">{formatCents(active.deductions.watchlist_total_cents, active.book.currency)}</td>
                          <td />
                          <td />
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  )}
                  <DismissedReveal
                    count={watchlistParts.hidden.length}
                    open={revealOpen["watchlist"] ?? false}
                    onToggle={() => setRevealOpen((r) => ({ ...r, watchlist: !r.watchlist }))}
                  >
                    {watchlistParts.hidden.map((w) => (
                      <RestoreRow
                        key={w.account_id}
                        label={`${w.name} · ${formatCents(w.total_cents, active.book.currency)}`}
                        onRestore={() =>
                          void setDismissed(active.book.id, findingFingerprint("watchlist", w.account_id), false)
                        }
                      />
                    ))}
                  </DismissedReveal>
                </div>

                {/* Substantiation gaps */}
                <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                  <h2 className="text-sm font-heading text-primary mb-3">Substantiation gaps</h2>
                  <p
                    className={`text-sm font-medium mb-3 inline-block rounded-md px-3 py-2 ${
                      active.deductions.substantiation_gaps.length > 0 ? "bg-warning/10 text-warning" : "text-muted-foreground"
                    }`}
                  >
                    {active.deductions.substantiation_gaps.length} entries · {formatCents(active.deductions.gap_total_cents, active.book.currency)}
                  </p>
                  {active.deductions.substantiation_gaps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Every purpose-required entry has a business purpose.</p>
                  ) : (
                    <>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                            <th className="py-1 pr-4 font-medium">Date</th>
                            <th className="py-1 pr-4 font-medium">Amount</th>
                            <th className="py-1 pr-4 font-medium">Counterparty</th>
                            <th className="py-1 pr-4 font-medium">Account</th>
                            <th className="py-1 pr-4 font-medium">Memo</th>
                            <th className="py-1 pr-4 font-medium">Receipt</th>
                            <th className="py-1" />
                          </tr>
                        </thead>
                        <tbody>
                          {gapParts.visible.slice(0, VISIBLE_ROW_CAP).map((gap) => (
                            <tr key={gap.entry_id} className="border-b last:border-0">
                              <td className="py-1.5 pr-4">{gap.occurred_on}</td>
                              <td className="py-1.5 pr-4">{formatCents(gap.amount_cents, active.book.currency)}</td>
                              <td className="py-1.5 pr-4">{gap.counterparty ?? "—"}</td>
                              <td className="py-1.5 pr-4">
                                <Link
                                  href={`/admin/books?book_id=${active.book.id}&account_id=${gap.account_id}&from=${from}&to=${to}`}
                                  className="hover:text-accent underline-offset-4 hover:underline"
                                >
                                  {gap.account_name}
                                </Link>
                              </td>
                              <td className="py-1.5 pr-4 text-muted-foreground">{gap.memo ?? ""}</td>
                              <td className="py-1.5 pr-4">
                                <ReceiptDot present={gap.has_document} />
                              </td>
                              <td className="py-1.5">
                                <DismissButton
                                  label={`Dismiss gap: ${gap.counterparty ?? gap.occurred_on}`}
                                  onClick={() =>
                                    void setDismissed(
                                      active.book.id,
                                      findingFingerprint("substantiation_gap", gap.entry_id),
                                      true,
                                    )
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {gapParts.visible.length > VISIBLE_ROW_CAP ? (
                        <p className="text-xs text-muted-foreground mt-2">
                          and {gapParts.visible.length - VISIBLE_ROW_CAP} more
                        </p>
                      ) : null}
                      <DismissedReveal
                        count={gapParts.hidden.length}
                        open={revealOpen["gaps"] ?? false}
                        onToggle={() => setRevealOpen((r) => ({ ...r, gaps: !r.gaps }))}
                      >
                        {gapParts.hidden.map((gap) => (
                          <RestoreRow
                            key={gap.entry_id}
                            label={`${gap.occurred_on} · ${gap.counterparty ?? "—"} · ${formatCents(gap.amount_cents, active.book.currency)}`}
                            onRestore={() =>
                              void setDismissed(
                                active.book.id,
                                findingFingerprint("substantiation_gap", gap.entry_id),
                                false,
                              )
                            }
                          />
                        ))}
                      </DismissedReveal>
                      <Link
                        href={`/admin/books?book_id=${active.book.id}&from=${from}&to=${to}`}
                        className="mt-2 inline-block text-xs text-muted-foreground hover:text-accent underline-offset-4 hover:underline"
                      >
                        Open ledger
                      </Link>
                    </>
                  )}
                </div>

                {/* Uncategorized expenses */}
                <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                  <h2 className="text-sm font-heading text-primary mb-3">Uncategorized expenses</h2>
                  <p
                    className={`text-sm font-medium mb-3 inline-block rounded-md px-3 py-2 ${
                      active.deductions.uncategorized.entry_count > 0 ? "bg-warning/10 text-warning" : "text-muted-foreground"
                    }`}
                  >
                    {active.deductions.uncategorized.entry_count} entries · {formatCents(active.deductions.uncategorized.total_cents, active.book.currency)}
                  </p>
                  {active.deductions.uncategorized.entries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No uncategorized expenses in this period.</p>
                  ) : (
                    <>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                            <th className="py-1 pr-4 font-medium">Date</th>
                            <th className="py-1 pr-4 font-medium">Amount</th>
                            <th className="py-1 pr-4 font-medium">Counterparty</th>
                            <th className="py-1 pr-4 font-medium">Memo</th>
                            <th className="py-1" />
                          </tr>
                        </thead>
                        <tbody>
                          {uncatParts.visible.slice(0, VISIBLE_ROW_CAP).map((entry) => (
                            <tr key={entry.entry_id} className="border-b last:border-0">
                              <td className="py-1.5 pr-4">
                                <Link
                                  href={`/admin/books?book_id=${active.book.id}&account_id=none&direction=expense&from=${from}&to=${to}`}
                                  className="hover:text-accent underline-offset-4 hover:underline"
                                >
                                  {entry.occurred_on}
                                </Link>
                              </td>
                              <td className="py-1.5 pr-4">{formatCents(entry.amount_cents, active.book.currency)}</td>
                              <td className="py-1.5 pr-4">{entry.counterparty ?? "—"}</td>
                              <td className="py-1.5 pr-4 text-muted-foreground">{entry.memo ?? ""}</td>
                              <td className="py-1.5">
                                <DismissButton
                                  label={`Dismiss uncategorized: ${entry.counterparty ?? entry.occurred_on}`}
                                  onClick={() =>
                                    void setDismissed(
                                      active.book.id,
                                      findingFingerprint("uncategorized", entry.entry_id),
                                      true,
                                    )
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {uncatParts.visible.length > VISIBLE_ROW_CAP ? (
                        <p className="text-xs text-muted-foreground mt-2">
                          and {uncatParts.visible.length - VISIBLE_ROW_CAP} more
                        </p>
                      ) : null}
                      <DismissedReveal
                        count={uncatParts.hidden.length}
                        open={revealOpen["uncategorized"] ?? false}
                        onToggle={() => setRevealOpen((r) => ({ ...r, uncategorized: !r.uncategorized }))}
                      >
                        {uncatParts.hidden.map((entry) => (
                          <RestoreRow
                            key={entry.entry_id}
                            label={`${entry.occurred_on} · ${entry.counterparty ?? "—"} · ${formatCents(entry.amount_cents, active.book.currency)}`}
                            onRestore={() =>
                              void setDismissed(
                                active.book.id,
                                findingFingerprint("uncategorized", entry.entry_id),
                                false,
                              )
                            }
                          />
                        ))}
                      </DismissedReveal>
                    </>
                  )}
                </div>

                {/* Profit by service line */}
                <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                  <div className="flex items-center gap-2 mb-3">
                    <h2 className="text-sm font-heading text-primary">Profit by service line</h2>
                    <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                      ESTIMATE
                    </span>
                  </div>
                  {active.profit.rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No income in this period.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                          <th className="py-1 pr-4 font-medium">Service line</th>
                          <th className="py-1 pr-4 font-medium">Income</th>
                          <th className="py-1 pr-4 font-medium">Direct costs</th>
                          <th className="py-1 pr-4 font-medium">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {active.profit.rows.map((r) => (
                          <tr key={r.service_line ?? "uncategorized"} className="border-b last:border-0">
                            <td className="py-1.5 pr-4">{r.label}</td>
                            <td className="py-1.5 pr-4 text-success">{formatCents(r.income_cents, active.book.currency)}</td>
                            <td className="py-1.5 pr-4 text-error">{formatCents(r.direct_cost_cents, active.book.currency)}</td>
                            <td className={`py-1.5 pr-4 ${r.net_estimate_cents >= 0 ? "text-success" : "text-error"}`}>
                              {formatCents(r.net_estimate_cents, active.book.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                    <p>Shared / overhead {formatCents(active.profit.shared_cost_cents, active.book.currency)}</p>
                    <p>Uncategorized {formatCents(active.profit.uncategorized_expense_cents, active.book.currency)}</p>
                  </div>
                  {active.profit.shared_cost_cents > 0 && active.profit.rows.every((r) => r.direct_cost_cents === 0) ? (
                    <p className="text-xs text-warning mt-2">
                      Tag expense categories with a service line (Manage categories) to attribute costs.
                    </p>
                  ) : null}
                </div>

                {/* Vendors & subscriptions */}
                <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                  <h2 className="text-sm font-heading text-primary mb-3">Vendors &amp; subscriptions</h2>
                  {active.vendors.recurring.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recurring charges detected in this period.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                          <th className="py-1 pr-4 font-medium">Vendor</th>
                          <th className="py-1 pr-4 font-medium">Account</th>
                          <th className="py-1" />
                        </tr>
                      </thead>
                      <tbody>
                        {vendorParts.visible.map((v) => (
                          <tr key={v.key} className="border-b last:border-0">
                            <td className="py-1.5 pr-4">
                              {v.display_name} —{" "}
                              {v.cadence === "monthly"
                                ? `~${formatCents(v.typical_amount_cents, active.book.currency)}/mo (≈${formatCents(v.annualized_cents, active.book.currency)}/yr)`
                                : `${formatCents(v.annualized_cents, active.book.currency)}/yr`}
                              {v.duplicate_group ? (
                                <span className="ml-2 inline-flex items-center rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                                  possible overlap
                                </span>
                              ) : null}
                            </td>
                            <td className="py-1.5 pr-4 text-muted-foreground">{v.account_name}</td>
                            <td className="py-1.5">
                              <DismissButton
                                label={`Dismiss vendor: ${v.display_name}`}
                                onClick={() =>
                                  void setDismissed(active.book.id, findingFingerprint("vendor", v.key), true)
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <DismissedReveal
                    count={vendorParts.hidden.length}
                    open={revealOpen["vendors"] ?? false}
                    onToggle={() => setRevealOpen((r) => ({ ...r, vendors: !r.vendors }))}
                  >
                    {vendorParts.hidden.map((v) => (
                      <RestoreRow
                        key={v.key}
                        label={`${v.display_name} · ${formatCents(v.annualized_cents, active.book.currency)}/yr`}
                        onRestore={() =>
                          void setDismissed(active.book.id, findingFingerprint("vendor", v.key), false)
                        }
                      />
                    ))}
                  </DismissedReveal>
                  <p className="text-xs text-muted-foreground mt-2">
                    {active.vendors.vendor_count} vendors seen · {active.vendors.unattributed_expense_count} entries without a vendor name
                  </p>
                </div>

                {/* Missing receipts & purposes (Phase 6b watchdog, D-10 — a chore list, no flag) */}
                <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                  <h2 className="text-sm font-heading text-primary mb-3">Missing receipts &amp; purposes</h2>
                  <p
                    className={`text-sm font-medium mb-3 inline-block rounded-md px-3 py-2 ${
                      watchdogRows.length > 0 ? "bg-warning/10 text-warning" : "text-muted-foreground"
                    }`}
                  >
                    {watchdogRows.length} entries ·{" "}
                    {formatCents(
                      watchdogRows.reduce((sum, f) => sum + f.amount_cents, 0),
                      active.book.currency,
                    )}
                  </p>
                  {watchdogRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing is missing a receipt or business purpose (entries 14+ days old).
                    </p>
                  ) : (
                    <>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                            <th className="py-1 pr-4 font-medium">Date</th>
                            <th className="py-1 pr-4 font-medium">Amount</th>
                            <th className="py-1 pr-4 font-medium">Counterparty</th>
                            <th className="py-1 pr-4 font-medium">Category</th>
                            <th className="py-1 pr-4 font-medium">Missing</th>
                            <th className="py-1" />
                          </tr>
                        </thead>
                        <tbody>
                          {watchdogParts.visible.slice(0, VISIBLE_ROW_CAP).map((f) => (
                            <tr key={f.entry_id} className="border-b last:border-0">
                              <td className="py-1.5 pr-4">{f.occurred_on}</td>
                              <td className="py-1.5 pr-4">{formatCents(f.amount_cents, active.book.currency)}</td>
                              <td className="py-1.5 pr-4">{f.counterparty ?? "—"}</td>
                              <td className="py-1.5 pr-4">{f.account_name}</td>
                              <td className="py-1.5 pr-4">
                                <span className="flex flex-wrap gap-1">
                                  {f.reasons.map((r) => (
                                    <span
                                      key={r}
                                      className="inline-flex items-center rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
                                    >
                                      {r === "no_document" ? "no receipt" : "no purpose"}
                                    </span>
                                  ))}
                                </span>
                              </td>
                              <td className="py-1.5">
                                <DismissButton
                                  label={`Dismiss missing-receipt row: ${f.counterparty ?? f.occurred_on}`}
                                  onClick={() =>
                                    void setDismissed(
                                      active.book.id,
                                      findingFingerprint("watchdog", f.entry_id),
                                      true,
                                    )
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {watchdogParts.visible.length > VISIBLE_ROW_CAP ? (
                        <p className="text-xs text-muted-foreground mt-2">
                          and {watchdogParts.visible.length - VISIBLE_ROW_CAP} more
                        </p>
                      ) : null}
                      <DismissedReveal
                        count={watchdogParts.hidden.length}
                        open={revealOpen["watchdog"] ?? false}
                        onToggle={() => setRevealOpen((r) => ({ ...r, watchdog: !r.watchdog }))}
                      >
                        {watchdogParts.hidden.map((f) => (
                          <RestoreRow
                            key={f.entry_id}
                            label={`${f.occurred_on} · ${f.counterparty ?? "—"} · ${formatCents(f.amount_cents, active.book.currency)}`}
                            onRestore={() =>
                              void setDismissed(active.book.id, findingFingerprint("watchdog", f.entry_id), false)
                            }
                          />
                        ))}
                      </DismissedReveal>
                    </>
                  )}
                </div>

                {/* Rolling tax forecast (Phase 6b, D-8/D-9 — business books only) */}
                {data && forecastForBook && active.book.book_kind === "business" ? (
                  <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-sm font-heading text-primary">Rolling tax forecast</h2>
                      <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                        ESTIMATE
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Estimate only — gross, cash-basis, flat rate you/your CPA entered; no entity/SE/QBI nuance. Your
                      CPA files.
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Year-to-date {data.forecast.ytd_from} → {data.forecast.ytd_to} — independent of the period
                      selected above.
                    </p>
                    <div className="space-y-1 text-sm">
                      <p>
                        YTD income{" "}
                        <span className="font-semibold text-success">
                          {formatCents(forecastForBook.forecast.ytd_income_cents, active.book.currency)}
                        </span>
                      </p>
                      <p>
                        YTD expenses{" "}
                        <span className="font-semibold text-error">
                          {formatCents(forecastForBook.forecast.ytd_expense_cents, active.book.currency)}
                        </span>
                      </p>
                      {forecastForBook.forecast.home_office_deduction_cents !== null ? (
                        <p>
                          Home-office proposal{" "}
                          <span className="font-semibold">
                            −{formatCents(forecastForBook.forecast.home_office_deduction_cents, active.book.currency)}
                          </span>
                        </p>
                      ) : null}
                      <p>
                        YTD net{" "}
                        <span
                          className={`font-semibold ${
                            forecastForBook.forecast.estimated_net_cents >= 0 ? "text-success" : "text-error"
                          }`}
                        >
                          {formatCents(forecastForBook.forecast.estimated_net_cents, active.book.currency)}
                        </span>
                      </p>
                      {forecastForBook.forecast.estimated_tax_cents === null ? (
                        <p className="text-muted-foreground">
                          No tax rate set — ask your CPA for a safe-harbor rate, then enter it below.
                        </p>
                      ) : (
                        <p>
                          Estimated tax at {forecastForBook.forecast.rate_percent}%{" "}
                          <span className="font-semibold">
                            {formatCents(forecastForBook.forecast.estimated_tax_cents, active.book.currency)}
                          </span>
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Next quarterly safe-harbor date: {forecastForBook.forecast.next_safe_harbor.label} (generic IRS
                        calendar — your CPA confirms your dates).
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                      <input
                        type="number"
                        min={0.01}
                        max={100}
                        step={0.01}
                        value={rateInput}
                        onChange={(e) => setRateInput(e.currentTarget.value)}
                        disabled={savingRate}
                        className="border-border rounded-md border px-3 py-2 text-sm w-28"
                        aria-label="Effective tax rate percent"
                      />
                      <Button size="sm" disabled={savingRate} onClick={handleSaveRate}>
                        Save
                      </Button>
                      <Button size="sm" variant="outline" disabled={savingRate} onClick={() => void saveRate(null)}>
                        Clear
                      </Button>
                    </div>
                  </div>
                ) : null}

                {data && bookId === data.home_office.target_book_id ? homeOfficeCard : null}
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
