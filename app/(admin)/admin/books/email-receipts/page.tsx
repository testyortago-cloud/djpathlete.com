import { EmailReceiptsClient } from "@/components/admin/bookkeeping/EmailReceiptsClient"
import { listAccounts, listBooks, listPendingEmailReceiptDocuments } from "@/lib/db/bookkeeping"
import { getPlatformConnection } from "@/lib/db/platform-connections"
import { getSetting } from "@/lib/db/system-settings"
import {
  DEFAULT_GMAIL_RECEIPT_LABEL, GMAIL_RECEIPTS_CRON_KEY, GMAIL_RECEIPT_LABEL_KEY,
  GMAIL_UNREADABLE_IDS_KEY,
} from "@/lib/bookkeeping/email-receipts"

export const metadata = { title: "Email Receipts — Accounting — Admin" }

export default async function EmailReceiptsPage() {
  const [books, documents, conn, label, pollerEnabled, unreadable] = await Promise.all([
    listBooks(),
    listPendingEmailReceiptDocuments(),
    getPlatformConnection("gmail"),
    getSetting<string>(GMAIL_RECEIPT_LABEL_KEY, DEFAULT_GMAIL_RECEIPT_LABEL),
    // 00193 seeds this flag FALSE. Promising "pulled hourly" while the cron is
    // off is the difference between "nothing to review yet" and "nothing will
    // ever arrive" — the page has to say which one it is.
    getSetting<boolean>(GMAIL_RECEIPTS_CRON_KEY, false),
    getSetting<unknown>(GMAIL_UNREADABLE_IDS_KEY, []),
  ])
  // The poller always ingests into the primary business book.
  const book = books.find((b) => b.is_primary && b.book_kind === "business") ?? null
  const accounts = book ? await listAccounts(book.id) : []
  return (
    <EmailReceiptsClient
      documents={documents}
      accounts={accounts}
      connectionStatus={conn?.status ?? null}
      label={label}
      pollerEnabled={pollerEnabled === true}
      needsManualUpload={Array.isArray(unreadable) ? unreadable.length : 0}
    />
  )
}
