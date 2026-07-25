"use client"

// Durable review surface for Gmail-polled receipts (Decision C-5). The photo
// flow's review state is browser-memory tied to the uploading session, so
// cron output needs this durable list — but the row editor and the commit
// route ARE the existing flow's (deviation from "existing review flow" is
// documented in the Track C design §3.4).
import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { AlertTriangle, Inbox, Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ReceiptRowEditor } from "@/components/admin/bookkeeping/ReceiptRowEditor"
import { rowFromEmailDocument } from "@/lib/bookkeeping/email-receipts"
import { SCANNABLE_MIMES } from "@/lib/bookkeeping/receipt-attachments"
import { parseAmountCents, rowValidationError, type ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
import { receiptSourceRef } from "@/lib/bookkeeping/receipts"
import type { BookkeepingAccount, BookkeepingDocument } from "@/types/database"

interface EmailReceiptsClientProps {
  documents: BookkeepingDocument[]
  accounts: BookkeepingAccount[]
  /** platform_connections.gmail status, verbatim — null when never connected. */
  connectionStatus: string | null
  label: string
  /** cron_bookkeeping_gmail_receipts_enabled. 00193 seeds it FALSE. */
  pollerEnabled: boolean
  /** Labeled emails the poller could not read (PDF/HEIC, or over the size cap). */
  needsManualUpload: number
}

/** "JPEG, PNG, or WebP" — derived from the allow-list the poller actually
 *  enforces so the promise on screen can never drift from the code again. */
export function readableFormatLabel(mimes: readonly string[] = SCANNABLE_MIMES): string {
  const names = mimes.map((m) => m.split("/")[1]?.toUpperCase() ?? m)
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`
}

export function EmailReceiptsClient({
  documents, accounts, connectionStatus, label, pollerEnabled, needsManualUpload,
}: EmailReceiptsClientProps) {
  const [rows, setRows] = useState<ReceiptBatchRow[]>(() =>
    documents.map((d) => rowFromEmailDocument(d, accounts)),
  )
  const docById = new Map(documents.map((d) => [d.id, d]))
  const formats = readableFormatLabel()
  // 'error' still holds a refresh token and retries every hour (lib/gmail/client
  // treats it as retryable and clears it on the next good refresh), so it is
  // NOT the "go connect Gmail" state.
  const credentialsPresent = connectionStatus === "connected" || connectionStatus === "error"

  const patchRow = (clientId: string, patch: Partial<ReceiptBatchRow>) =>
    setRows((prev) => prev.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)))

  const postRow = async (row: ReceiptBatchRow) => {
    const doc = docById.get(row.clientId)
    if (!doc) return
    const invalid = rowValidationError(row, accounts)
    if (invalid) {
      toast.error(invalid)
      return
    }
    patchRow(row.clientId, { status: "posting", error: null })
    try {
      const res = await fetch("/api/admin/bookkeeping/receipts/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: doc.book_id,
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
      toast.success(json.inserted === 0 ? "Already posted — removed from the queue" : "Receipt posted")
    } catch (error) {
      patchRow(row.clientId, { status: "post_failed", error: (error as Error).message })
      toast.error((error as Error).message)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-primary">Email Receipts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {pollerEnabled ? (
            <>
              Receipts pulled hourly from Gmail messages labeled &lsquo;{label}&rsquo;. Review each one and post it to
              the ledger.
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
              {needsManualUpload} labeled email{needsManualUpload === 1 ? "" : "s"} carried an attachment this importer
              can&apos;t read — a PDF, a HEIC photo, or a file over 10&nbsp;MB. Nothing was imported from{" "}
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
                No email receipts pending. Label an email that has a {formats} image attached with &lsquo;{label}&rsquo;
                {pollerEnabled ? " and it appears within the hour" : ""}. PDF attachments, HEIC photos and body-only
                emails (no attachment) aren&apos;t imported — photo-upload those from{" "}
                <Link href="/admin/books" className="underline text-primary">
                  Accounting
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        rows.map((row) => (
          <Card key={row.clientId}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base font-heading">{row.fileName}</CardTitle>
              <Button size="sm" disabled={row.status === "posting"} onClick={() => postRow(row)}>
                {row.status === "posting" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Post
              </Button>
            </CardHeader>
            <CardContent>
              {row.status === "scan_failed" && (
                <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 mb-3 flex items-start gap-2">
                  <AlertTriangle className="size-4 mt-0.5 text-warning shrink-0" />
                  <div className="text-xs text-warning/90">
                    <p className="text-sm font-medium text-warning">Scan failed — retry</p>
                    <p>{row.error}</p>
                  </div>
                </div>
              )}
              {row.status !== "scan_failed" && row.error && <p className="text-xs text-error mb-2">{row.error}</p>}
              <ReceiptRowEditor
                row={row}
                accounts={accounts}
                disabled={row.status === "posting"}
                onEdit={(patch) => patchRow(row.clientId, patch)}
                onPreviewLoaded={(url) => patchRow(row.clientId, { previewUrl: url })}
              />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
