"use client"

// Durable review surface for Gmail-polled receipts (Decision C-5), organized
// as a triage board instead of one long scroll: For review / Needs a look /
// Possible duplicates. Cards are compact (vendor · amount · date · book);
// the full editor opens in a dialog. Every card can Post (into ANY book — the
// commit route re-homes email docs) or Ignore (drops out of the queue without
// posting; the document itself stays for retention).
import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { AlertTriangle, ArrowLeft, Copy, Inbox, Loader2, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ReceiptRowEditor } from "@/components/admin/bookkeeping/ReceiptRowEditor"
import { bucketEmailReceiptRows, rowFromEmailDocument } from "@/lib/bookkeeping/email-receipts"
import { SCANNABLE_MIMES } from "@/lib/bookkeeping/receipt-attachments"
import {
  parseAmountCents, resolveExpenseAccount, rowValidationError, type ReceiptBatchRow,
} from "@/lib/bookkeeping/receipt-batch"
import { receiptSourceRef } from "@/lib/bookkeeping/receipts"
import type { BookkeepingAccount, BookkeepingBook, BookkeepingDocument } from "@/types/database"

interface EmailReceiptsClientProps {
  documents: BookkeepingDocument[]
  books: BookkeepingBook[]
  /** Categories per book id — the card's book picker swaps the category list
   *  live (each book is its own tax context). */
  accountsByBook: Record<string, BookkeepingAccount[]>
  /** platform_connections.gmail status, verbatim — null when never connected. */
  connectionStatus: string | null
  label: string
  /** cron_bookkeeping_gmail_receipts_enabled. 00193 seeds it FALSE. */
  pollerEnabled: boolean
  /** Labeled emails the poller could not read (HEIC, an over-cap PDF, a file
   *  over the size cap, or an email body too large to parse). */
  needsManualUpload: number
}

/** "JPEG, PNG, or WebP" — derived from the allow-list the poller actually
 *  enforces so the promise on screen can never drift from the code again. */
export function readableFormatLabel(mimes: readonly string[] = SCANNABLE_MIMES): string {
  const names = mimes.map((m) => m.split("/")[1]?.toUpperCase() ?? m)
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`
}

const CONFIDENCE_CHIP: Record<string, string> = {
  high: "border-success/40 bg-success/10 text-success",
  medium: "border-accent/40 bg-accent/10 text-foreground",
  low: "border-warning/40 bg-warning/10 text-warning",
}

export function EmailReceiptsClient({
  documents, books, accountsByBook, connectionStatus, label, pollerEnabled, needsManualUpload,
}: EmailReceiptsClientProps) {
  const [rows, setRows] = useState<ReceiptBatchRow[]>(() =>
    documents.map((d) => rowFromEmailDocument(d, accountsByBook[d.book_id] ?? [])),
  )
  // Per-card target book. Unset = the book the poller ingested into.
  const [rowBook, setRowBook] = useState<Record<string, string>>({})
  const [openRowId, setOpenRowId] = useState<string | null>(null)

  const docById = new Map(documents.map((d) => [d.id, d]))
  const formats = readableFormatLabel()
  // 'error' still holds a refresh token and retries every hour (lib/gmail/client
  // treats it as retryable and clears it on the next good refresh), so it is
  // NOT the "go connect Gmail" state.
  const credentialsPresent = connectionStatus === "connected" || connectionStatus === "error"

  const bookForRow = (row: ReceiptBatchRow) =>
    rowBook[row.clientId] ?? docById.get(row.clientId)?.book_id ?? ""
  const accountsForRow = (row: ReceiptBatchRow) => accountsByBook[bookForRow(row)] ?? []

  const patchRow = (clientId: string, patch: Partial<ReceiptBatchRow>) =>
    setRows((prev) => prev.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)))

  // Categories are per book, so switching the book re-resolves the AI's
  // suggested category against the NEW book's accounts (name match, else
  // Uncategorized) — a stale account id from another book would 409 on post.
  const changeBook = (row: ReceiptBatchRow, bookId: string) => {
    setRowBook((prev) => ({ ...prev, [row.clientId]: bookId }))
    patchRow(row.clientId, {
      accountId: resolveExpenseAccount(row.result?.suggested_category ?? null, accountsByBook[bookId] ?? []),
    })
  }

  const postRow = async (row: ReceiptBatchRow) => {
    const doc = docById.get(row.clientId)
    if (!doc) return
    const invalid = rowValidationError(row, accountsForRow(row))
    if (invalid) {
      toast.error(invalid)
      setOpenRowId(row.clientId)
      return
    }
    patchRow(row.clientId, { status: "posting", error: null })
    try {
      const res = await fetch("/api/admin/bookkeeping/receipts/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookForRow(row),
          document_id: doc.id,
          account_id: row.accountId || null,
          amount_cents: parseAmountCents(row.amount),
          occurred_on: row.occurredOn,
          counterparty: row.counterparty || null,
          business_purpose: row.businessPurpose || null,
          memo: null,
          source_ref: receiptSourceRef(doc.id),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "Failed to post receipt")
      setRows((prev) => prev.filter((r) => r.clientId !== row.clientId))
      setOpenRowId((id) => (id === row.clientId ? null : id))
      toast.success(json.inserted === 0 ? "Already posted — removed from the queue" : "Receipt posted")
    } catch (error) {
      patchRow(row.clientId, { status: "post_failed", error: (error as Error).message })
      toast.error((error as Error).message)
    }
  }

  const ignoreRow = async (row: ReceiptBatchRow) => {
    const doc = docById.get(row.clientId)
    if (!doc) return
    patchRow(row.clientId, { status: "posting", error: null })
    try {
      const res = await fetch("/api/admin/bookkeeping/receipts/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: doc.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "Failed to ignore receipt")
      setRows((prev) => prev.filter((r) => r.clientId !== row.clientId))
      setOpenRowId((id) => (id === row.clientId ? null : id))
      toast.success("Ignored — it won't come back")
    } catch (error) {
      patchRow(row.clientId, { status: "post_failed", error: (error as Error).message })
      toast.error((error as Error).message)
    }
  }

  const buckets = bucketEmailReceiptRows(rows)
  const openRow = openRowId ? (rows.find((r) => r.clientId === openRowId) ?? null) : null

  const columns = [
    {
      key: "review" as const,
      title: "For review",
      hint: "Scanned clean — check and post.",
      icon: Inbox,
      accentClass: "border-t-accent",
      rows: buckets.review,
    },
    {
      key: "attention" as const,
      title: "Needs a look",
      hint: "Failed or uncertain reads — open before posting.",
      icon: AlertTriangle,
      accentClass: "border-t-warning",
      rows: buckets.attention,
    },
    {
      key: "duplicates" as const,
      title: "Possible duplicates",
      hint: "Same vendor, amount and date as another card — post one, ignore the twin.",
      icon: Copy,
      accentClass: "border-t-border",
      rows: buckets.duplicates,
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/books"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft className="size-3.5" />
          Accounting
        </Link>
        <h1 className="mt-1 text-2xl font-heading text-primary">Email Receipts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {pollerEnabled ? (
            <>
              Receipts pulled hourly from Gmail messages labeled &lsquo;{label}&rsquo; or forwarded from a watched
              address. Review each one and post it to the ledger.
            </>
          ) : (
            <>
              Hourly Gmail importing is <span className="font-medium text-warning">turned off</span>, so nothing new
              arrives here. Switch on{" "}
              <span className="font-mono text-xs">cron_bookkeeping_gmail_receipts_enabled</span> in{" "}
              <Link href="/admin/settings" className="underline text-primary">
                Settings
              </Link>{" "}
              to start importing Gmail messages labeled &lsquo;{label}&rsquo;.
            </>
          )}
        </p>
      </div>

      {pollerEnabled && connectionStatus === "error" && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="py-4 text-sm text-warning flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>
              Gmail reported an authorization error on its last token refresh. The importer retries every hour and
              clears this by itself once Google answers again — if receipts stop arriving, reconnect in{" "}
              <Link href="/admin/inbox" className="underline">
                Admin → Inbox
              </Link>
              .
            </span>
          </CardContent>
        </Card>
      )}

      {needsManualUpload > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="py-4 text-sm text-warning flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>
              {needsManualUpload} labeled email{needsManualUpload === 1 ? "" : "s"} carried a receipt this importer
              can&apos;t read — a HEIC photo, a PDF over 10 pages, a file over 10&nbsp;MB, or an email body too large
              to parse. Nothing was imported from{" "}
              {needsManualUpload === 1 ? "it" : "them"}. Open{" "}
              {needsManualUpload === 1 ? "that email" : "those emails"} and photo-upload the receipt from{" "}
              <Link href="/admin/books" className="underline">
                Accounting
              </Link>
              . This is a running record since importing started; it clears itself if support for those formats is
              added later.
            </span>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Inbox className="size-6 mx-auto text-muted-foreground" />
            {!credentialsPresent ? (
              <p className="text-sm text-muted-foreground">
                Connect Gmail in{" "}
                <Link href="/admin/inbox" className="underline text-primary">
                  Admin → Inbox
                </Link>
                , then apply the &lsquo;{label}&rsquo; label to receipt emails.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                No email receipts pending. Forward a receipt email to the connected Gmail from a watched address
                (Settings &rsaquo; <span className="font-mono text-xs">bookkeeping_gmail_receipt_forwarders</span>),
                or label any email &lsquo;{label}&rsquo;
                {pollerEnabled ? " — it appears within the hour" : ""}. A {formats} attachment or the email body
                itself both import. HEIC photos and PDFs over 10 pages still need a photo upload from{" "}
                <Link href="/admin/books" className="underline text-primary">
                  Accounting
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {columns.map((col) => (
            <section
              key={col.key}
              aria-label={col.title}
              className={`rounded-xl border border-border border-t-2 ${col.accentClass} bg-muted/30`}
            >
              <header className="flex items-center gap-2 px-3 pt-3 pb-1">
                <col.icon className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-heading font-semibold text-foreground">{col.title}</h2>
                <span className="ml-auto inline-flex min-w-6 justify-center rounded-full border border-border bg-card px-1.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                  {col.rows.length}
                </span>
              </header>
              <p className="px-3 pb-2 text-xs text-muted-foreground">{col.hint}</p>
              <div className="max-h-[62vh] space-y-2 overflow-y-auto px-2 pb-2">
                {col.rows.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                    Nothing here
                  </div>
                ) : (
                  col.rows.map((row) => {
                    const dupTwin = buckets.duplicateOf[row.clientId]
                    const twin = dupTwin ? rows.find((r) => r.clientId === dupTwin) : null
                    const busy = row.status === "posting"
                    return (
                      <Card key={row.clientId} className="border-border bg-card">
                        <CardContent className="space-y-2 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => setOpenRowId(row.clientId)}
                              className="min-w-0 text-left"
                              title="Open details"
                            >
                              <p className="truncate text-sm font-medium text-foreground underline-offset-2 hover:underline">
                                {row.counterparty || row.fileName}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">{row.fileName}</p>
                            </button>
                            <p className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">
                              {row.amount ? `$${row.amount}` : "—"}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="text-muted-foreground">{row.occurredOn || "no date"}</span>
                            {row.result && (
                              <span
                                className={`rounded-full border px-1.5 py-0.5 leading-none ${CONFIDENCE_CHIP[row.result.confidence] ?? CONFIDENCE_CHIP.low}`}
                              >
                                {row.result.confidence}
                              </span>
                            )}
                            {row.status === "scan_failed" && (
                              <span className="rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 leading-none text-warning">
                                scan failed
                              </span>
                            )}
                            {twin && (
                              <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 leading-none text-muted-foreground">
                                twin of {twin.counterparty || twin.fileName}
                              </span>
                            )}
                          </div>

                          {row.error && row.status !== "scan_failed" && (
                            <p className="text-xs text-error">{row.error}</p>
                          )}

                          <Select value={bookForRow(row)} disabled={busy} onValueChange={(v) => changeBook(row, v)}>
                            <SelectTrigger aria-label={`Book for ${row.fileName}`} className="h-8 w-full text-xs">
                              <SelectValue placeholder="Book" />
                            </SelectTrigger>
                            <SelectContent>
                              {books.map((b) => (
                                <SelectItem key={b.id} value={b.id}>
                                  {b.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <div className="flex items-center justify-end gap-1.5 pt-0.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-muted-foreground"
                              disabled={busy}
                              onClick={() => ignoreRow(row)}
                            >
                              <X className="size-3.5" />
                              Ignore
                            </Button>
                            <Button size="sm" className="h-7 px-2.5 text-xs" disabled={busy} onClick={() => postRow(row)}>
                              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                              Post
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={openRow != null} onOpenChange={(open) => !open && setOpenRowId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {openRow && (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading text-base">{openRow.fileName}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Post into book</p>
                  <Select
                    value={bookForRow(openRow)}
                    disabled={openRow.status === "posting"}
                    onValueChange={(v) => changeBook(openRow, v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Book" />
                    </SelectTrigger>
                    <SelectContent>
                      {books.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {openRow.status === "scan_failed" && openRow.error && (
                  <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 flex items-start gap-2">
                    <AlertTriangle className="size-4 mt-0.5 text-warning shrink-0" />
                    <div className="text-xs text-warning/90">
                      <p className="text-sm font-medium text-warning">Scan failed — retry</p>
                      <p>{openRow.error}</p>
                    </div>
                  </div>
                )}
                <ReceiptRowEditor
                  row={openRow}
                  accounts={accountsForRow(openRow)}
                  disabled={openRow.status === "posting"}
                  onEdit={(patch) => patchRow(openRow.clientId, patch)}
                  onPreviewLoaded={(url) => patchRow(openRow.clientId, { previewUrl: url })}
                />
              </div>
              <DialogFooter className="gap-2">
                <Button variant="ghost" disabled={openRow.status === "posting"} onClick={() => ignoreRow(openRow)}>
                  <X className="size-4" />
                  Ignore
                </Button>
                <Button disabled={openRow.status === "posting"} onClick={() => postRow(openRow)}>
                  {openRow.status === "posting" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Post
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
