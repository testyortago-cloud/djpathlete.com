"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Plus, Upload, BookOpen, Banknote, Camera, ShoppingCart, BarChart3, Lightbulb, Package, Tags, FilterX, Mail, ScanSearch, CircleHelp } from "lucide-react"
import { toast } from "sonner"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { LedgerTable } from "@/components/admin/bookkeeping/LedgerTable"
import { ManualEntryDialog } from "@/components/admin/bookkeeping/ManualEntryDialog"
import { ImportPlatformDialog } from "@/components/admin/bookkeeping/ImportPlatformDialog"
import { StatementImportDialog } from "@/components/admin/bookkeeping/StatementImportDialog"
import { ReceiptCashDialog } from "@/components/admin/bookkeeping/ReceiptCashDialog"
import { ReceiptUploadDialog } from "@/components/admin/bookkeeping/ReceiptUploadDialog"
import { AmazonImportDialog } from "@/components/admin/bookkeeping/AmazonImportDialog"
import { DuplicateScanDialog } from "@/components/admin/bookkeeping/DuplicateScanDialog"
import { SetupBanner, SetupPanel } from "@/components/admin/bookkeeping/SetupPanel"
import { CloseMonthCard } from "@/components/admin/bookkeeping/CloseMonthCard"
import { formatCents } from "@/lib/bookkeeping/money"
import { PERIOD_PRESET_LABELS, presetRange, type PeriodPreset } from "@/lib/bookkeeping/period"
import type {
  BookkeepingBook,
  BookkeepingAccount,
  BookkeepingLedgerEntry,
  BookkeepingPeriodClose,
  LedgerDirection,
  LedgerSource,
} from "@/types/database"

interface Filters {
  from: string
  to: string
  direction: LedgerDirection | ""
  accountId: string
  source: LedgerSource | ""
  q: string
  page: number
}

/** Deep-link hydration payload (5b): every filter except the page cursor. */
export type BooksClientInitialFilters = Omit<Filters, "page">

interface EntriesData {
  rows: BookkeepingLedgerEntry[]
  total: number
  totals: { income_cents: number; expense_cents: number }
  page: number
  perPage: number
}

const EMPTY_FILTERS: Filters = { from: "", to: "", direction: "", accountId: "", source: "", q: "", page: 1 }

const EMPTY_DATA: EntriesData = { rows: [], total: 0, totals: { income_cents: 0, expense_cents: 0 }, page: 1, perPage: 50 }

const SOURCE_OPTIONS: { value: LedgerSource | ""; label: string }[] = [
  { value: "", label: "All sources" },
  { value: "manual", label: "Manual" },
  { value: "platform_import", label: "Platform" },
  { value: "statement_import", label: "Statement" },
  { value: "receipt", label: "Receipt" },
]

export function BooksClient({
  books,
  initialBookId,
  initialAccounts,
  initialFilters,
  emailReceiptsPending = 0,
}: {
  books: BookkeepingBook[]
  initialBookId: string
  initialAccounts: BookkeepingAccount[]
  initialFilters?: BooksClientInitialFilters
  /** Open email-receipt review rows — the header badge that says "go look". */
  emailReceiptsPending?: number
}) {
  const [bookId, setBookId] = useState(initialBookId)
  // Deep-link hydration (5b): useState initializers only — no effect, no reset
  // guard needed (the accountId reset lives in handleBookChange, which is
  // user-event-only and never fires on mount).
  const [filters, setFilters] = useState<Filters>(() =>
    initialFilters ? { ...EMPTY_FILTERS, ...initialFilters } : EMPTY_FILTERS,
  )
  const [data, setData] = useState<EntriesData>(EMPTY_DATA)
  const [accounts, setAccounts] = useState<BookkeepingAccount[]>(initialAccounts)
  const [loading, setLoading] = useState(false)
  const isFirstAccountsLoad = useRef(true)
  // Guards against a stale in-flight response overwriting a newer one when
  // filters/page change rapidly — mirrors the `cancelled` flag pattern used
  // by the accounts-fetch effect below, but as a ref since fetchEntries is
  // also invoked imperatively (onSaved/onChanged) outside of an effect.
  const fetchRequestIdRef = useRef(0)
  const [manualEntryOpen, setManualEntryOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<BookkeepingLedgerEntry | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [statementOpen, setStatementOpen] = useState(false)
  const [cashReceiptOpen, setCashReceiptOpen] = useState(false)
  const [uploadReceiptOpen, setUploadReceiptOpen] = useState(false)
  const [amazonOpen, setAmazonOpen] = useState(false)
  const [dupScanOpen, setDupScanOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [closes, setCloses] = useState<BookkeepingPeriodClose[]>([])

  const fetchEntries = useCallback(async () => {
    if (!bookId) return
    const requestId = ++fetchRequestIdRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("book_id", bookId)
      if (filters.from) params.set("from", filters.from)
      if (filters.to) params.set("to", filters.to)
      if (filters.direction) params.set("direction", filters.direction)
      if (filters.accountId) params.set("account_id", filters.accountId)
      if (filters.source) params.set("source", filters.source)
      if (filters.q) params.set("q", filters.q)
      params.set("page", String(filters.page))
      const res = await fetch(`/api/admin/bookkeeping/entries?${params.toString()}`)
      if (!res.ok) throw new Error((await res.text()) || "Failed to load entries")
      const body = (await res.json()) as EntriesData
      if (requestId !== fetchRequestIdRef.current) return // a newer request superseded this one
      setData(body)
    } catch (error) {
      if (requestId !== fetchRequestIdRef.current) return
      toast.error(`Failed to load entries: ${(error as Error).message}`)
    } finally {
      if (requestId === fetchRequestIdRef.current) setLoading(false)
    }
  }, [bookId, filters])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  // Refetch the account list whenever the active book changes (skip the
  // very first render — the server page already supplied initialAccounts).
  useEffect(() => {
    if (isFirstAccountsLoad.current) {
      isFirstAccountsLoad.current = false
      return
    }
    if (!bookId) {
      setAccounts([])
      return
    }
    let cancelled = false
    fetch(`/api/admin/bookkeeping/accounts?book_id=${bookId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load accounts")
        return res.json()
      })
      .then((body: { accounts: BookkeepingAccount[] }) => {
        if (!cancelled) setAccounts(body.accounts ?? [])
      })
      .catch((error) => {
        if (!cancelled) toast.error(`Failed to load accounts: ${(error as Error).message}`)
      })
    return () => {
      cancelled = true
    }
  }, [bookId])

  const fetchCloses = useCallback(async () => {
    if (!bookId) {
      setCloses([])
      return
    }
    try {
      const res = await fetch(`/api/admin/bookkeeping/closes?book_id=${bookId}`)
      if (!res.ok) throw new Error("Failed to load closed months")
      const body = (await res.json()) as { closes: BookkeepingPeriodClose[] }
      setCloses(body.closes ?? [])
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [bookId])

  useEffect(() => {
    void fetchCloses()
  }, [fetchCloses])

  function handleBookChange(newBookId: string) {
    setBookId(newBookId)
    setFilters((f) => ({ ...f, accountId: "", page: 1 }))
  }

  function updateFilter(patch: Partial<Omit<Filters, "page">>) {
    setFilters((f) => ({ ...f, ...patch, page: 1 }))
  }

  // Period preset drives from/to; "custom" reveals the raw date inputs.
  const [preset, setPreset] = useState<"all" | "custom" | PeriodPreset>(() =>
    initialFilters && (initialFilters.from || initialFilters.to) ? "custom" : "all",
  )

  function handlePresetChange(value: string) {
    const next = value as "all" | "custom" | PeriodPreset
    setPreset(next)
    if (next === "all") updateFilter({ from: "", to: "" })
    else if (next !== "custom") updateFilter(presetRange(next, new Date().toISOString().slice(0, 10)))
  }

  const hasActiveFilters =
    filters.from !== "" || filters.to !== "" || filters.direction !== "" ||
    filters.accountId !== "" || filters.source !== "" || filters.q !== ""

  function clearFilters() {
    setPreset("all")
    setFilters(EMPTY_FILTERS)
  }

  // Stat cards toggle the direction filter (Net = all activity).
  function toggleDirection(direction: LedgerDirection | "") {
    updateFilter({ direction: filters.direction === direction ? "" : direction })
  }

  function goToPage(page: number) {
    setFilters((f) => ({ ...f, page }))
  }

  function openAddEntry() {
    setEditingEntry(null)
    setManualEntryOpen(true)
  }

  function openEditEntry(entry: BookkeepingLedgerEntry) {
    setEditingEntry(entry)
    setManualEntryOpen(true)
  }

  const net = data.totals.income_cents - data.totals.expense_cents
  const totalPages = Math.max(1, Math.ceil(data.total / (data.perPage || 50)))
  const selectedBook = books.find((b) => b.id === bookId)

  if (books.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading text-primary">Accounting</h1>
        <EmptyState
          icon={BookOpen}
          heading="No books configured"
          description="No bookkeeping books exist yet. Seed the business book to get started."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Tabs value={bookId} onValueChange={handleBookChange}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-heading text-primary">Accounting</h1>
            <p className="text-sm text-muted-foreground mt-1">Income and expense ledger.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/books/email-receipts"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-accent hover:text-accent"
            >
              <Mail className="size-4" />
              Email Receipts
              {emailReceiptsPending > 0 && (
                <span
                  aria-label={`${emailReceiptsPending} receipts waiting for review`}
                  className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-error px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums"
                >
                  {emailReceiptsPending > 99 ? "99+" : emailReceiptsPending}
                </span>
              )}
            </Link>
            <Link
              href="/admin/books/reports"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-accent hover:text-accent"
            >
              <BarChart3 className="size-4" />
              Reports
            </Link>
            <Link
              href="/admin/books/insights"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-accent hover:text-accent"
            >
              <Lightbulb className="size-4" />
              Insights
            </Link>
            <Link
              href="/admin/books/assets"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-accent hover:text-accent"
            >
              <Package className="size-4" />
              Assets
            </Link>
            <Link
              href="/admin/books/accounts"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-accent hover:text-accent"
            >
              <Tags className="size-4" />
              Categories
            </Link>
          </div>
        </div>

        {/* Book switcher — contained, high-contrast (each book is a separate tax context) */}
        <TabsList className="mt-4 h-auto flex-wrap gap-1 rounded-lg border border-border bg-muted p-1">
          {books.map((book) => (
            <TabsTrigger
              key={book.id}
              value={book.id}
              className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
            >
              {book.name}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={bookId} className="space-y-6 mt-4">
          {/* Stat cards — click to filter the ledger below */}
          <div className="grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => toggleDirection("income")}
              aria-pressed={filters.direction === "income"}
              title="Show income entries only"
              className={`rounded-xl border bg-card p-4 text-left transition-all hover:border-success/60 ${
                filters.direction === "income" ? "border-success ring-1 ring-success" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Income</p>
                {filters.direction === "income" && (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">filtering</span>
                )}
              </div>
              <p className="mt-1 text-2xl font-heading text-success">{formatCents(data.totals.income_cents)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Click to show only income</p>
            </button>
            <button
              type="button"
              onClick={() => toggleDirection("expense")}
              aria-pressed={filters.direction === "expense"}
              title="Show expense entries only"
              className={`rounded-xl border bg-card p-4 text-left transition-all hover:border-error/60 ${
                filters.direction === "expense" ? "border-error ring-1 ring-error" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Expenses</p>
                {filters.direction === "expense" && (
                  <span className="rounded-full bg-error/10 px-2 py-0.5 text-[10px] font-medium text-error">filtering</span>
                )}
              </div>
              <p className="mt-1 text-2xl font-heading text-error">{formatCents(data.totals.expense_cents)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Click to show only expenses</p>
            </button>
            <button
              type="button"
              onClick={() => toggleDirection("")}
              aria-pressed={filters.direction === ""}
              title="Show all activity"
              className={`rounded-xl border bg-card p-4 text-left transition-all hover:border-accent/60 ${
                filters.direction === "" ? "border-accent ring-1 ring-accent" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Net</p>
                {filters.direction === "" && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">all activity</span>
                )}
              </div>
              <p className={`mt-1 text-2xl font-heading ${net >= 0 ? "text-success" : "text-error"}`}>
                {formatCents(net)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Click to show everything</p>
            </button>
          </div>

          <CloseMonthCard
            bookId={bookId}
            closes={closes}
            onChanged={() => {
              void fetchCloses()
              void fetchEntries()
            }}
          />

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={openAddEntry}>
              <Plus className="size-4" />
              Add entry
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" />
              Import platform income
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStatementOpen(true)}>
              <Upload className="size-4" />
              Import statement
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCashReceiptOpen(true)}>
              <Banknote className="size-4" />
              Add cash receipt
            </Button>
            <Button size="sm" variant="outline" onClick={() => setUploadReceiptOpen(true)}>
              <Camera className="size-4" />
              Upload receipt
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAmazonOpen(true)}>
              <ShoppingCart className="size-4" />
              Import Amazon
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDupScanOpen(true)}>
              <ScanSearch className="size-4" />
              Find duplicates
            </Button>
            <Button size="sm" variant="outline" aria-label="Accounting setup and tour" onClick={() => setSetupOpen(true)}>
              <CircleHelp className="size-4" />
            </Button>
          </div>

          <SetupBanner onOpen={() => setSetupOpen(true)} />

          {/* Filter bar — labeled controls; the period preset drives from/to */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Period</span>
                <select
                  value={preset}
                  onChange={(e) => handlePresetChange(e.currentTarget.value)}
                  className="border-border bg-background rounded-md border px-3 py-2 text-sm"
                >
                  <option value="all">All time</option>
                  {(Object.keys(PERIOD_PRESET_LABELS) as PeriodPreset[]).map((p) => (
                    <option key={p} value={p}>
                      {PERIOD_PRESET_LABELS[p]}
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
                      value={filters.from}
                      onChange={(e) => updateFilter({ from: e.currentTarget.value })}
                      className="border-border bg-background rounded-md border px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">To</span>
                    <input
                      type="date"
                      value={filters.to}
                      onChange={(e) => updateFilter({ to: e.currentTarget.value })}
                      className="border-border bg-background rounded-md border px-3 py-2 text-sm"
                    />
                  </label>
                </>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Category</span>
                <select
                  value={filters.accountId}
                  onChange={(e) => updateFilter({ accountId: e.currentTarget.value })}
                  className="border-border bg-background rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">All categories</option>
                  {/* "none" sentinel — uncategorized entries (account_id NULL);
                      the DAL maps it to .is("account_id", null). */}
                  <option value="none">Uncategorized</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Source</span>
                <select
                  value={filters.source}
                  onChange={(e) => updateFilter({ source: e.currentTarget.value as LedgerSource | "" })}
                  className="border-border bg-background rounded-md border px-3 py-2 text-sm"
                >
                  {SOURCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Search</span>
                <input
                  key={filters.q}
                  type="text"
                  defaultValue={filters.q}
                  onBlur={(e) => updateFilter({ q: e.currentTarget.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") updateFilter({ q: e.currentTarget.value })
                  }}
                  placeholder="Memo or counterparty…"
                  className="border-border bg-background rounded-md border px-3 py-2 text-sm"
                />
              </label>
              {hasActiveFilters && (
                <Button size="sm" variant="ghost" onClick={clearFilters} className="mb-0.5">
                  <FilterX className="size-4" />
                  Clear filters
                </Button>
              )}
            </div>
          </div>

          {/* Body */}
          {data.total === 0 && !loading ? (
            <EmptyState
              icon={BookOpen}
              heading="No entries yet"
              description="No ledger entries match the current filters. Add a manual entry or import platform income to get started."
            />
          ) : (
            <>
              <div className="rounded-lg border border-border bg-card p-4 space-y-4 overflow-x-auto">
                <LedgerTable rows={data.rows} accounts={accounts} onChanged={fetchEntries} onEdit={openEditEntry} />
                <div className="flex items-center justify-between border-t border-border pt-3 text-sm text-muted-foreground">
                <p>
                  {data.total} entr{data.total === 1 ? "y" : "ies"}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filters.page <= 1}
                    onClick={() => goToPage(filters.page - 1)}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {filters.page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filters.page >= totalPages}
                    onClick={() => goToPage(filters.page + 1)}
                  >
                    Next
                  </Button>
                </div>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <ManualEntryDialog
        bookId={bookId}
        accounts={accounts}
        entry={editingEntry}
        open={manualEntryOpen}
        onOpenChange={setManualEntryOpen}
        onSaved={fetchEntries}
        closedPeriods={closes.map((c) => c.period)}
      />
      <ImportPlatformDialog
        bookId={bookId}
        bookKind={selectedBook?.book_kind ?? "business"}
        bookIsPrimary={selectedBook?.is_primary ?? true}
        bookName={selectedBook?.name ?? ""}
        accounts={accounts}
        open={importOpen}
        onOpenChange={setImportOpen}
        onSaved={fetchEntries}
      />
      <StatementImportDialog
        bookId={bookId}
        bookKind={selectedBook?.book_kind ?? "business"}
        bookIsPrimary={selectedBook?.is_primary ?? true}
        bookName={selectedBook?.name ?? ""}
        accounts={accounts}
        open={statementOpen}
        onOpenChange={setStatementOpen}
        onSaved={fetchEntries}
      />
      <ReceiptCashDialog
        bookId={bookId}
        accounts={accounts}
        open={cashReceiptOpen}
        onOpenChange={setCashReceiptOpen}
        onSaved={fetchEntries}
      />
      <ReceiptUploadDialog
        bookId={bookId}
        bookName={selectedBook?.name ?? ""}
        accounts={accounts}
        open={uploadReceiptOpen}
        onOpenChange={setUploadReceiptOpen}
        onSaved={fetchEntries}
      />
      <AmazonImportDialog
        bookId={bookId}
        accounts={accounts}
        open={amazonOpen}
        onOpenChange={setAmazonOpen}
        onSaved={fetchEntries}
      />
      <DuplicateScanDialog
        bookId={bookId}
        accounts={accounts}
        open={dupScanOpen}
        onOpenChange={setDupScanOpen}
        onEntriesChanged={fetchEntries}
      />
      <SetupPanel
        open={setupOpen}
        onOpenChange={setSetupOpen}
        // wired to startBooksTour in Task 5
        onStartTour={() => {}}
      />
    </div>
  )
}
