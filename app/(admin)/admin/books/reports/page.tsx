import { listBooks } from "@/lib/db/bookkeeping"
import { ReportsClient } from "@/components/admin/bookkeeping/ReportsClient"

export const metadata = { title: "Reports — Books — Admin" }

export default async function BooksReportsPage() {
  const books = await listBooks()
  return <ReportsClient books={books} />
}
