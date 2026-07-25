import { EmailReceiptsClient } from "@/components/admin/bookkeeping/EmailReceiptsClient"
import { listAccounts, listBooks, listPendingEmailReceiptDocuments } from "@/lib/db/bookkeeping"
import { getPlatformConnection } from "@/lib/db/platform-connections"
import { getSetting } from "@/lib/db/system-settings"

export const metadata = { title: "Email Receipts — Accounting — Admin" }

export default async function EmailReceiptsPage() {
  const [books, documents, conn, label] = await Promise.all([
    listBooks(),
    listPendingEmailReceiptDocuments(),
    getPlatformConnection("gmail"),
    getSetting<string>("bookkeeping_gmail_receipt_label", "DJP Receipts"),
  ])
  // The poller always ingests into the primary business book.
  const book = books.find((b) => b.is_primary && b.book_kind === "business") ?? null
  const accounts = book ? await listAccounts(book.id) : []
  return (
    <EmailReceiptsClient
      documents={documents}
      accounts={accounts}
      gmailConnected={conn?.status === "connected"}
      label={label}
    />
  )
}
