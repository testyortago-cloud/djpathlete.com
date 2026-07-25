import { listBooks, listAccounts } from "@/lib/db/bookkeeping"
import { BooksClient, type BooksClientInitialFilters } from "@/components/admin/bookkeeping/BooksClient"

export const metadata = { title: "Accounting — Admin" }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SOURCES = ["manual", "platform_import", "statement_import", "receipt"] as const

// Next 16 async-searchParams convention (reports/print/page.tsx precedent).
// Junk params fall back silently — a shared deep-link must always render.
export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ book_id?: string; account_id?: string; direction?: string; from?: string; to?: string; source?: string; q?: string }>
}) {
  const sp = await searchParams
  const books = await listBooks()
  const linked = sp.book_id ? books.find((b) => b.id === sp.book_id) : undefined
  const active = linked ?? books.find((b) => b.is_primary) ?? books[0]
  const accounts = active ? await listAccounts(active.id) : []
  const accountIdValid = sp.account_id === "none" || accounts.some((a) => a.id === sp.account_id)
  const initialFilters: BooksClientInitialFilters = {
    from: sp.from && DATE_RE.test(sp.from) ? sp.from : "",
    to: sp.to && DATE_RE.test(sp.to) ? sp.to : "",
    direction: sp.direction === "income" || sp.direction === "expense" ? sp.direction : "",
    accountId: sp.account_id && accountIdValid ? sp.account_id : "",
    source: (SOURCES as readonly string[]).includes(sp.source ?? "") ? (sp.source as (typeof SOURCES)[number]) : "",
    q: sp.q ?? "",
  }
  return (
    <BooksClient
      books={books}
      initialBookId={active?.id ?? ""}
      initialAccounts={accounts}
      initialFilters={initialFilters}
    />
  )
}
