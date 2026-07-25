import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { BooksClient } from "@/components/admin/bookkeeping/BooksClient"
import type { BookkeepingBook } from "@/types/database"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const fetchUrls: string[] = []
function jsonRes(body: unknown) {
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) }
}

const BOOK: BookkeepingBook = {
  id: "b0000000-0000-4000-8000-000000000001",
  name: "Darren — DJP Athlete",
  book_kind: "business",
  owner_label: "Darren",
  is_primary: true,
  currency: "usd",
  sort_order: 0,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchUrls.length = 0
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    fetchUrls.push(url)
    if (url.includes("/entries")) {
      return jsonRes({ rows: [], total: 0, totals: { income_cents: 0, expense_cents: 0 }, page: 1, perPage: 50 })
    }
    if (url.includes("/closes")) return jsonRes({ closes: [] })
    return jsonRes({ accounts: [] })
  }) as unknown as typeof fetch
})

describe("<BooksClient> deep-link hydration", () => {
  it("hydrates initialFilters into the first entries fetch and the Category select", async () => {
    render(
      <BooksClient
        books={[BOOK]}
        initialBookId={BOOK.id}
        initialAccounts={[]}
        initialFilters={{ from: "2026-01-01", to: "2026-06-30", direction: "expense", accountId: "none", source: "", q: "" }}
      />,
    )
    await waitFor(() => {
      const entriesUrl = fetchUrls.find((u) => u.includes("/entries"))
      expect(entriesUrl).toBeDefined()
      expect(entriesUrl).toContain("account_id=none")
      expect(entriesUrl).toContain("direction=expense")
      expect(entriesUrl).toContain("from=2026-01-01")
    })
    expect(screen.getByRole("option", { name: "Uncategorized" })).toBeInTheDocument()
    expect((screen.getByDisplayValue("Uncategorized") as HTMLSelectElement).value).toBe("none")
  })

  it("without initialFilters the first entries fetch carries no filter params", async () => {
    render(<BooksClient books={[BOOK]} initialBookId={BOOK.id} initialAccounts={[]} />)
    await waitFor(() => {
      expect(fetchUrls.find((u) => u.includes("/entries"))).toBeDefined()
    })
    const entriesUrl = fetchUrls.find((u) => u.includes("/entries")) as string
    expect(entriesUrl).not.toContain("account_id=")
    expect(entriesUrl).not.toContain("direction=")
    expect(entriesUrl).not.toContain("from=")
  })
})
