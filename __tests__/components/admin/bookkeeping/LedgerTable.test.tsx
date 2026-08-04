import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { LedgerTable } from "@/components/admin/bookkeeping/LedgerTable"
import type { BookkeepingAccount, BookkeepingLedgerEntry } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ACCOUNTS = [{ id: "acc-1", name: "Equipment" } as BookkeepingAccount]

// A real Amazon product title — the shape that stretched the memo column until
// the whole ledger scrolled sideways.
const LONG_MEMO =
  "Weight Plates with Grip: 2 Inch Standard Calibrated Weight Plates for Strength Training and Weightlifting in Home Gym (5LB Pair)"
const SHORT_MEMO = "Lea J Athlete — program purchase"

function entry(over: Partial<BookkeepingLedgerEntry> = {}): BookkeepingLedgerEntry {
  return {
    id: "e1",
    book_id: "b1",
    account_id: "acc-1",
    direction: "expense",
    amount_cents: 5000,
    currency: "usd",
    occurred_on: "2026-07-01",
    memo: SHORT_MEMO,
    business_purpose: null,
    counterparty: null,
    source: "manual",
    document_id: null,
    adjusts_period: null,
    ...over,
  } as BookkeepingLedgerEntry
}

function renderTable(rows: BookkeepingLedgerEntry[]) {
  render(<LedgerTable rows={rows} accounts={ACCOUNTS} onChanged={vi.fn()} onEdit={vi.fn()} />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("<LedgerTable> long memos", () => {
  it("clamps a long memo behind Show more and expands it in place", () => {
    renderTable([entry({ memo: LONG_MEMO })])

    // The text is always in the DOM — the clamp is visual, so it stays
    // searchable and copyable. What changes is the line-clamp class.
    const memo = screen.getByText(LONG_MEMO)
    expect(memo.className).toContain("line-clamp-2")

    fireEvent.click(screen.getByRole("button", { name: "Show more" }))
    expect(screen.getByText(LONG_MEMO).className).not.toContain("line-clamp-2")

    fireEvent.click(screen.getByRole("button", { name: "Show less" }))
    expect(screen.getByText(LONG_MEMO).className).toContain("line-clamp-2")
  })

  it("leaves a short memo alone — no toggle, no clamp", () => {
    renderTable([entry({ memo: SHORT_MEMO })])
    expect(screen.getByText(SHORT_MEMO).className).not.toContain("line-clamp-2")
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument()
  })

  it("clamps a long business_purpose too (receipt rows carry no memo)", () => {
    const purpose = `${LONG_MEMO} used for client sessions`
    renderTable([entry({ memo: null, business_purpose: purpose })])
    expect(screen.getByText(purpose).className).toContain("line-clamp-2")
    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument()
  })

  it("each row's toggle is independent", () => {
    const other = `${LONG_MEMO} second row`
    renderTable([entry({ id: "e1", memo: LONG_MEMO }), entry({ id: "e2", memo: other })])

    fireEvent.click(screen.getAllByRole("button", { name: "Show more" })[0])
    expect(screen.getByText(LONG_MEMO).className).not.toContain("line-clamp-2")
    expect(screen.getByText(other).className).toContain("line-clamp-2")
  })

  it("bounds the memo cell and lets it wrap instead of widening the table", () => {
    renderTable([entry({ memo: LONG_MEMO })])
    const cell = screen.getByText(LONG_MEMO).closest("td")
    // Without whitespace-normal, TableCell's nowrap makes max-w meaningless.
    expect(cell?.className).toContain("whitespace-normal")
    expect(cell?.className).toContain("max-w-")
  })
})
