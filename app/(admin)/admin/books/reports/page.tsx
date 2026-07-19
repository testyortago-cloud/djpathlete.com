import { listBooks } from "@/lib/db/bookkeeping"
import { getSetting } from "@/lib/db/system-settings"
import { ReportsClient } from "@/components/admin/bookkeeping/ReportsClient"

export const metadata = { title: "Reports — Accounting — Admin" }

export default async function BooksReportsPage() {
  const [books, emailPackEnabled, accountantEmail] = await Promise.all([
    listBooks(),
    getSetting<boolean>("bookkeeping_email_pack_enabled", false),
    getSetting<string>("bookkeeping_accountant_email", ""),
  ])
  return <ReportsClient books={books} emailPackEnabled={emailPackEnabled} defaultAccountantEmail={accountantEmail} />
}
