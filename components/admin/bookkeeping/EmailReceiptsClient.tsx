"use client"

// Durable review surface for Gmail-polled receipts (Decision C-5). The photo
// flow's review state is browser-memory tied to the uploading session, so
// cron output needs this durable list — but the row editor and the commit
// route ARE the existing flow's (deviation from "existing review flow" is
// documented in the Track C design §3.4).
import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Inbox, Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ReceiptRowEditor } from "@/components/admin/bookkeeping/ReceiptRowEditor"
import { rowFromEmailDocument } from "@/lib/bookkeeping/email-receipts"
import { parseAmountCents, rowValidationError, type ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
import { receiptSourceRef } from "@/lib/bookkeeping/receipts"
import type { BookkeepingAccount, BookkeepingDocument } from "@/types/database"

interface EmailReceiptsClientProps {
  documents: BookkeepingDocument[]
  accounts: BookkeepingAccount[]
  gmailConnected: boolean
  label: string
}

export function EmailReceiptsClient({ documents, accounts, gmailConnected, label }: EmailReceiptsClientProps) {
  const [rows, setRows] = useState<ReceiptBatchRow[]>(() =>
    documents.map((d) => rowFromEmailDocument(d, accounts)),
  )
  const docById = new Map(documents.map((d) => [d.id, d]))

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
          Receipts pulled hourly from Gmail messages labeled &lsquo;{label}&rsquo;. Review each one and post it to the
          ledger.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Inbox className="size-6 mx-auto text-muted-foreground" />
            {!gmailConnected ? (
              <p className="text-sm text-muted-foreground">
                Connect Gmail in{" "}
                <Link href="/admin/inbox" className="underline text-primary">
                  Admin → Inbox
                </Link>
                , then apply the &lsquo;{label}&rsquo; label to receipt emails.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                No email receipts pending. Label a receipt email with an attached PDF or image &lsquo;{label}&rsquo; and
                it appears within the hour. Body-only emails (no attachment) aren&apos;t imported — forward them to
                yourself with the receipt attached, or use photo upload.
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
              {row.error && <p className="text-xs text-error mb-2">{row.error}</p>}
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
