import { listBooks, listAccounts } from "@/lib/db/bookkeeping"
import { BooksClient } from "@/components/admin/bookkeeping/BooksClient"

export const metadata = { title: "Books — Admin" }

export default async function BooksPage() {
  const books = await listBooks()
  const primary = books.find((b) => b.is_primary) ?? books[0]
  const accounts = primary ? await listAccounts(primary.id) : []
  return <BooksClient books={books} initialBookId={primary?.id ?? ""} initialAccounts={accounts} />
}
