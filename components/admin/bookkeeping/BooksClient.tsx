"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Plus, Upload, BookOpen, Banknote, Camera, ShoppingCart } from "lucide-react"
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
import { formatCents } from "@/lib/bookkeeping/money"
import type {
  BookkeepingBook,
  BookkeepingAccount,
  BookkeepingLedgerEntry,
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
}: {
  books: BookkeepingBook[]
  initialBookId: string
  initialAccounts: BookkeepingAccount[]
}) {
  const [bookId, setBookId] = useState(initialBookId)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
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

  function handleBookChange(newBookId: string) {
    setBookId(newBookId)
    setFilters((f) => ({ ...f, accountId: "", page: 1 }))
  }

  function updateFilter(patch: Partial<Omit<Filters, "page">>) {
    setFilters((f) => ({ ...f, ...patch, page: 1 }))
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
        <h1 className="text-2xl font-heading text-primary">Books</h1>
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-heading text-primary">Books</h1>
            <p className="text-sm text-muted-foreground mt-1">Income and expense ledger.</p>
          </div>
          <TabsList>
            {books.map((book) => (
              <TabsTrigger key={book.id} value={book.id}>
                {book.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value={bookId} className="space-y-6 mt-4">
          {/* Totals strip */}
          <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-card p-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Income</p>
              <p className="text-lg font-heading text-success">{formatCents(data.totals.income_cents)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Expenses</p>
              <p className="text-lg font-heading text-error">{formatCents(data.totals.expense_cents)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Net</p>
              <p className={`text-lg font-heading ${net >= 0 ? "text-success" : "text-error"}`}>
                {formatCents(net)}
              </p>
            </div>
          </div>

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
            <Link
              href="/admin/books/reports"
              className="ml-auto text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline"
            >
              Reports
            </Link>
            <Link
              href="/admin/books/accounts"
              className="text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline"
            >
              Manage categories
            </Link>
          </div>

          {/* Filter bar */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <input
              type="date"
              value={filters.from}
              onChange={(e) => updateFilter({ from: e.currentTarget.value })}
              className="border-border rounded-md border px-3 py-2 text-sm"
              aria-label="From date"
            />
            <input
              type="date"
              value={filters.to}
              onChange={(e) => updateFilter({ to: e.currentTarget.value })}
              className="border-border rounded-md border px-3 py-2 text-sm"
              aria-label="To date"
            />
            <select
              value={filters.direction}
              onChange={(e) => updateFilter({ direction: e.currentTarget.value as LedgerDirection | "" })}
              className="border-border rounded-md border px-3 py-2 text-sm"
              aria-label="Direction"
            >
              <option value="">All</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
            <select
              value={filters.accountId}
              onChange={(e) => updateFilter({ accountId: e.currentTarget.value })}
              className="border-border rounded-md border px-3 py-2 text-sm"
              aria-label="Category"
            >
              <option value="">All categories</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              value={filters.source}
              onChange={(e) => updateFilter({ source: e.currentTarget.value as LedgerSource | "" })}
              className="border-border rounded-md border px-3 py-2 text-sm"
              aria-label="Source"
            >
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              defaultValue={filters.q}
              onBlur={(e) => updateFilter({ q: e.currentTarget.value })}
              placeholder="Search memo / counterparty..."
              className="border-border rounded-md border px-3 py-2 text-sm"
              aria-label="Search"
            />
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
              <LedgerTable rows={data.rows} accounts={accounts} onChanged={fetchEntries} onEdit={openEditEntry} />
              <div className="flex items-center justify-between text-sm text-muted-foreground">
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
    </div>
  )
}
