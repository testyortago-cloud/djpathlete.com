// Component-level coverage for the B4 dismissal UI. The route/pure-fn suites
// (finding-fingerprint, insights-dismissals, insights GET) cannot see any of
// this: the verb chosen per action, the optimistic rollback, or the reveal
// partition all live in InsightsClient. Mirrors the RTL harness used by
// __tests__/components/admin/AdGroupAdList.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { InsightsClient } from "@/components/admin/bookkeeping/InsightsClient"
import type { BookkeepingBook } from "@/types/database"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const BOOK: BookkeepingBook = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Business",
  book_kind: "business",
  owner_label: null,
  is_primary: true,
  currency: "usd",
  sort_order: 0,
  archived_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
}

const ACCOUNT_ACTIVE = "22222222-2222-4222-8222-222222222222"
const ACCOUNT_DISMISSED = "33333333-3333-4333-8333-333333333333"

function insightsPayload(overrides: { dismissed?: string[]; yearEndFlags?: unknown[] } = {}) {
  return {
    from: "2026-01-01",
    to: "2026-12-31",
    home_office_percent: null,
    books: [
      {
        book: { id: BOOK.id, name: BOOK.name, book_kind: "business", is_primary: true, currency: "usd" },
        deductions: {
          watchlist: [
            {
              account_id: ACCOUNT_ACTIVE,
              name: "Travel",
              tax_category: null,
              archived: false,
              total_cents: 12_555,
              entry_count: 2,
              top_counterparties: [],
            },
            {
              account_id: ACCOUNT_DISMISSED,
              name: "Meals",
              tax_category: null,
              archived: false,
              total_cents: 5_000,
              entry_count: 1,
              top_counterparties: [],
            },
          ],
          watchlist_total_cents: 17_555,
          substantiation_gaps: [],
          gap_total_cents: 0,
          uncategorized: { total_cents: 0, entry_count: 0, entries: [] },
        },
        profit: {
          rows: [],
          income_total_cents: 0,
          direct_cost_total_cents: 0,
          shared_cost_cents: 0,
          uncategorized_expense_cents: 0,
        },
        vendors: {
          recurring: [],
          vendor_count: 0,
          unattributed_expense_count: 0,
          unattributed_expense_cents: 0,
        },
        row_count: 3,
        ...(overrides.dismissed === undefined ? {} : { dismissed_fingerprints: overrides.dismissed }),
      },
    ],
    home_office: {
      percent: null,
      target_book_id: null,
      household_books: [],
      inputs: [],
      input_total_cents: 0,
      proposed_total_cents: null,
      excluded_household_expense_cents: 0,
    },
    year_end_flags: overrides.yearEndFlags ?? [],
    forecast: { ytd_from: "2026-01-01", ytd_to: "2026-07-25", rate_percent: null, books: [] },
    watchdog: [],
  }
}

/** Routes the insights GET to `payload`; every dismissals call resolves `{ok: dismissalsOk}`. */
function mockFetch(payload: unknown, dismissalsOk = true) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.startsWith("/api/admin/bookkeeping/insights?")) {
      return { ok: true, json: async () => payload }
    }
    return { ok: dismissalsOk, json: async () => ({ ok: dismissalsOk }) }
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

/** All non-GET dismissals calls, as `{method, body}`. */
function dismissalCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter((c) => String(c[0]) === "/api/admin/bookkeeping/insights/dismissals")
    .map((c) => {
      const init = c[1] as RequestInit
      return { method: init.method, body: JSON.parse(String(init.body)) as Record<string, string> }
    })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("<InsightsClient> dismissals", () => {
  it("hides a server-dismissed row behind the reveal and keeps active rows in the table", async () => {
    mockFetch(insightsPayload({ dismissed: [`watchlist:${ACCOUNT_DISMISSED}`] }))
    render(<InsightsClient books={[BOOK]} initialHomeOfficePercent={null} />)

    expect(await screen.findByText("Travel")).toBeInTheDocument()
    expect(screen.queryByText("Meals")).not.toBeInTheDocument()

    const reveal = screen.getByRole("button", { name: /1 dismissed/i })
    fireEvent.click(reveal)
    expect(screen.getByText(/Meals ·/)).toBeInTheDocument()
  })

  it("POSTs on dismiss and DELETEs on restore, with the same (book_id, fingerprint) pair", async () => {
    const fetchMock = mockFetch(insightsPayload({ dismissed: [`watchlist:${ACCOUNT_DISMISSED}`] }))
    render(<InsightsClient books={[BOOK]} initialHomeOfficePercent={null} />)
    await screen.findByText("Travel")

    fireEvent.click(screen.getByRole("button", { name: /dismiss watchlist row: travel/i }))
    await waitFor(() => expect(dismissalCalls(fetchMock)).toHaveLength(1))
    expect(dismissalCalls(fetchMock)[0]).toEqual({
      method: "POST",
      body: { book_id: BOOK.id, fingerprint: `watchlist:${ACCOUNT_ACTIVE}` },
    })

    fireEvent.click(screen.getByRole("button", { name: /2 dismissed/i }))
    const restores = screen.getAllByRole("button", { name: "Restore" })
    // Meals is the server-dismissed row; Travel was just optimistically dismissed.
    fireEvent.click(restores[restores.length - 1])
    await waitFor(() => expect(dismissalCalls(fetchMock)).toHaveLength(2))
    expect(dismissalCalls(fetchMock)[1]).toEqual({
      method: "DELETE",
      body: { book_id: BOOK.id, fingerprint: `watchlist:${ACCOUNT_DISMISSED}` },
    })
  })

  it("rolls the row back into the table and toasts when the dismiss call fails", async () => {
    mockFetch(insightsPayload({ dismissed: [] }), false)
    render(<InsightsClient books={[BOOK]} initialHomeOfficePercent={null} />)
    await screen.findByText("Travel")

    fireEvent.click(screen.getByRole("button", { name: /dismiss watchlist row: travel/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to dismiss the finding"))
    expect(screen.getByText("Travel")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /dismissed/i })).not.toBeInTheDocument()
  })

  it("retires optimistic overrides when a fresh GET lands (server truth wins)", async () => {
    mockFetch(insightsPayload({ dismissed: [] }))
    render(<InsightsClient books={[BOOK]} initialHomeOfficePercent={null} />)
    await screen.findByText("Travel")

    fireEvent.click(screen.getByRole("button", { name: /dismiss watchlist row: travel/i }))
    await waitFor(() => expect(screen.queryByText("Travel")).not.toBeInTheDocument())

    // Changing the period refetches; the new payload has no dismissals, so the
    // optimistic override must be dropped rather than shadowing server truth.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "last_year" } })
    expect(await screen.findByText("Travel")).toBeInTheDocument()
  })

  it("renders year-end flags when a book payload omits dismissed_fingerprints (stale cached GET)", async () => {
    mockFetch(
      insightsPayload({
        yearEndFlags: [{ id: "q4_timing", title: "Year-end is approaching", detail: "Generic timing note." }],
      }),
    )
    render(<InsightsClient books={[BOOK]} initialHomeOfficePercent={null} />)

    expect(await screen.findByText("Year-end is approaching")).toBeInTheDocument()
  })
})
