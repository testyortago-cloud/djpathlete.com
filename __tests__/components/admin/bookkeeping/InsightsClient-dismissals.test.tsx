// @vitest-environment jsdom
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

const WATCHDOG_ACTIVE = "44444444-4444-4444-8444-444444444444"
const WATCHDOG_DISMISSED = "55555555-5555-4555-8555-555555555555"

function watchdogRow(entryId: string, counterparty: string, amountCents: number) {
  return {
    entry_id: entryId,
    book_id: BOOK.id,
    account_id: ACCOUNT_ACTIVE,
    account_name: "Travel",
    occurred_on: "2026-03-04",
    amount_cents: amountCents,
    counterparty,
    reasons: ["no_document"],
  }
}

function insightsPayload(
  overrides: { dismissed?: string[]; yearEndFlags?: unknown[]; watchdog?: unknown[] } = {},
) {
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
    watchdog: overrides.watchdog ?? [],
  }
}

/** Routes the insights GET to `payload`; the dismissals POST/DELETE never settles,
 *  so the assertion runs while the write is still in flight. */
function mockFetchWithHangingDismissals(payload: unknown) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.startsWith("/api/admin/bookkeeping/insights?")) {
      return { ok: true, json: async () => payload }
    }
    return new Promise(() => {})
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
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

// The watchdog and year-end call sites are the two the other suites never reach:
// the finder prefix is hardcoded at each call site, so a copy-paste of the wrong
// prefix (or of the wrong id field) writes a fingerprint the GET can never match
// and the dismissal silently resurfaces on the next load. These pin the exact
// string the UI sends and the exact string it honours coming back.
describe("<InsightsClient> watchdog dismissals", () => {
  const WATCHDOG = [
    watchdogRow(WATCHDOG_ACTIVE, "Shell", 4_211),
    watchdogRow(WATCHDOG_DISMISSED, "Chipotle", 1_899),
  ]

  it("honours a server watchdog:<entry_id> dismissal — hidden from the table, restorable from the reveal", async () => {
    mockFetch(
      insightsPayload({
        watchdog: WATCHDOG,
        dismissed: [`watchdog:${WATCHDOG_DISMISSED}`],
      }),
    )
    render(<InsightsClient books={[BOOK]} initialHomeOfficePercent={null} />)

    expect(await screen.findByText("Shell")).toBeInTheDocument()
    expect(screen.queryByText("Chipotle")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /1 dismissed/i }))
    expect(screen.getByText(/Chipotle/)).toBeInTheDocument()
  })

  it("does NOT honour the same entry id under another finder's prefix", async () => {
    // substantiation_gap:<id> and watchdog:<id> address different findings over
    // the same entry — collapsing them would hide a row nobody dismissed.
    mockFetch(
      insightsPayload({
        watchdog: WATCHDOG,
        dismissed: [`substantiation_gap:${WATCHDOG_DISMISSED}`],
      }),
    )
    render(<InsightsClient books={[BOOK]} initialHomeOfficePercent={null} />)

    expect(await screen.findByText("Chipotle")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /dismissed/i })).not.toBeInTheDocument()
  })

  it("labels the headline chip when the table below it hides rows", async () => {
    // The chip keeps the FULL recompute (2 entries · $61.10) because dismissals
    // collapse rows without changing computed numbers — so it has to say that
    // out loud, or the chip and the one-row table contradict each other.
    mockFetch(insightsPayload({ watchdog: WATCHDOG, dismissed: [`watchdog:${WATCHDOG_DISMISSED}`] }))
    render(<InsightsClient books={[BOOK]} initialHomeOfficePercent={null} />)

    expect(await screen.findByText(/2 entries · \$61\.10 · includes 1 dismissed/)).toBeInTheDocument()
  })

  it("leaves the chip unlabelled when nothing is dismissed", async () => {
    mockFetch(insightsPayload({ watchdog: WATCHDOG, dismissed: [] }))
    render(<InsightsClient books={[BOOK]} initialHomeOfficePercent={null} />)

    expect(await screen.findByText(/2 entries · \$61\.10$/)).toBeInTheDocument()
  })

  it("POSTs watchdog:<entry_id> on dismiss and DELETEs the same string on restore", async () => {
    const fetchMock = mockFetch(insightsPayload({ watchdog: WATCHDOG, dismissed: [] }))
    render(<InsightsClient books={[BOOK]} initialHomeOfficePercent={null} />)
    await screen.findByText("Shell")

    fireEvent.click(screen.getByRole("button", { name: /dismiss missing-receipt row: shell/i }))
    await waitFor(() => expect(dismissalCalls(fetchMock)).toHaveLength(1))
    expect(dismissalCalls(fetchMock)[0]).toEqual({
      method: "POST",
      body: { book_id: BOOK.id, fingerprint: `watchdog:${WATCHDOG_ACTIVE}` },
    })

    fireEvent.click(screen.getByRole("button", { name: /1 dismissed/i }))
    fireEvent.click(screen.getByRole("button", { name: "Restore" }))
    await waitFor(() => expect(dismissalCalls(fetchMock)).toHaveLength(2))
    expect(dismissalCalls(fetchMock)[1]).toEqual({
      method: "DELETE",
      body: { book_id: BOOK.id, fingerprint: `watchdog:${WATCHDOG_ACTIVE}` },
    })
  })
})

describe("<InsightsClient> year-end flag dismissals", () => {
  const FLAGS = [
    { id: "q4_timing", title: "Year-end is approaching", detail: "Generic timing note." },
    { id: "home_office_unset", title: "Office share not set", detail: "Enter a percent." },
  ]

  it("honours a server year_end:<flag id> dismissal scoped to the primary book", async () => {
    mockFetch(insightsPayload({ yearEndFlags: FLAGS, dismissed: ["year_end:home_office_unset"] }))
    render(<InsightsClient books={[BOOK]} initialHomeOfficePercent={null} />)

    expect(await screen.findByText("Year-end is approaching")).toBeInTheDocument()
    expect(screen.queryByText("Office share not set")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /1 dismissed/i }))
    expect(screen.getByText("Office share not set")).toBeInTheDocument()
  })

  it("POSTs year_end:<flag id> against the primary book, and DELETEs the same pair on restore", async () => {
    const fetchMock = mockFetch(insightsPayload({ yearEndFlags: FLAGS, dismissed: [] }))
    render(<InsightsClient books={[BOOK]} initialHomeOfficePercent={null} />)
    await screen.findByText("Year-end is approaching")

    fireEvent.click(screen.getByRole("button", { name: /dismiss flag: year-end is approaching/i }))
    await waitFor(() => expect(dismissalCalls(fetchMock)).toHaveLength(1))
    expect(dismissalCalls(fetchMock)[0]).toEqual({
      method: "POST",
      body: { book_id: BOOK.id, fingerprint: "year_end:q4_timing" },
    })

    fireEvent.click(screen.getByRole("button", { name: /1 dismissed/i }))
    fireEvent.click(screen.getByRole("button", { name: "Restore" }))
    await waitFor(() => expect(dismissalCalls(fetchMock)).toHaveLength(2))
    expect(dismissalCalls(fetchMock)[1]).toEqual({
      method: "DELETE",
      body: { book_id: BOOK.id, fingerprint: "year_end:q4_timing" },
    })
  })

  it("keeps an in-flight dismissal hidden when a refetch lands (no visible bounce-back)", async () => {
    // The year-end strip is the one card that stays interactive during a refetch
    // (every other card is replaced by "Loading…"), so its dismissal is the one
    // that can be racing a GET whose payload was computed before the POST landed.
    mockFetchWithHangingDismissals(insightsPayload({ yearEndFlags: FLAGS, dismissed: [] }))
    render(<InsightsClient books={[BOOK]} initialHomeOfficePercent={null} />)
    await screen.findByText("Year-end is approaching")

    fireEvent.click(screen.getByRole("button", { name: /dismiss flag: year-end is approaching/i }))
    await waitFor(() => expect(screen.queryByText("Year-end is approaching")).not.toBeInTheDocument())

    // Refetch (period change). The server payload still shows the flag as active
    // because the POST has not settled — the optimistic override must survive.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "last_year" } })
    await waitFor(() => expect(screen.getByText("Office share not set")).toBeInTheDocument())
    expect(screen.queryByText("Year-end is approaching")).not.toBeInTheDocument()
  })
})
