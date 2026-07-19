import { listBooks, listAssets } from "@/lib/db/bookkeeping"
import { AssetsClient } from "@/components/admin/bookkeeping/AssetsClient"

export const metadata = { title: "Equipment & Assets — Accounting — Admin" }

export default async function AssetsPage() {
  const books = await listBooks()
  const primary = books.find((b) => b.is_primary) ?? books[0]
  const assets = primary ? await listAssets(primary.id) : []
  return <AssetsClient books={books} initialBookId={primary?.id ?? ""} initialAssets={assets} />
}
