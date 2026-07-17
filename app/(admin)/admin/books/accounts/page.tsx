import { listBooks, listAccounts } from "@/lib/db/bookkeeping"
import { AccountsManager } from "@/components/admin/bookkeeping/AccountsManager"

export const metadata = { title: "Chart of Accounts — Admin" }

export default async function AccountsPage() {
  const books = await listBooks()
  const primary = books.find((b) => b.is_primary) ?? books[0]
  const accounts = primary ? await listAccounts(primary.id) : []
  return <AccountsManager books={books} initialBookId={primary?.id ?? ""} initialAccounts={accounts} />
}
