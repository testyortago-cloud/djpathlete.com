// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ManualEntryDialog } from "@/components/admin/bookkeeping/ManualEntryDialog"
import type { BookkeepingAccount, BookkeepingLedgerEntry } from "@/types/database"

const accounts = [
  { id: "acc1", name: "Performance Training — Stripe", account_type: "income" },
] as BookkeepingAccount[]

const imported = {
  id: "e1", book_id: "b1", account_id: null, direction: "income", amount_cents: 32000,
  occurred_on: "2026-07-01", memo: "old memo", counterparty: "old cp", business_purpose: null,
  source: "platform_import", adjusts_period: null,
} as BookkeepingLedgerEntry

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ entry: {} }) })
  vi.stubGlobal("fetch", fetchMock)
})

describe("ManualEntryDialog locked (imported) mode", () => {
  it("locks money fields, titles as imported, and shows the lock caption", () => {
    render(<ManualEntryDialog bookId="b1" accounts={accounts} entry={imported} open onOpenChange={() => {}} onSaved={() => {}} />)
    expect(screen.getByText("Edit imported entry")).toBeInTheDocument()
    expect(screen.getByLabelText(/amount/i)).toBeDisabled()
    expect(screen.getByLabelText(/date/i)).toBeDisabled()
    expect(screen.getByRole("button", { name: "Income" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Expense" })).toBeDisabled()
    expect(screen.getByText(/locked — imported from platform records/i)).toBeInTheDocument()
  })

  it("PATCHes ONLY the four editable keys in locked mode", async () => {
    render(<ManualEntryDialog bookId="b1" accounts={accounts} entry={imported} open onOpenChange={() => {}} onSaved={() => {}} />)
    fireEvent.change(screen.getByLabelText(/memo/i), { target: { value: "new memo" } })
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("/api/admin/bookkeeping/entries/e1")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(Object.keys(body).sort()).toEqual(["account_id", "business_purpose", "counterparty", "memo"])
    expect(body.memo).toBe("new memo")
  })

  it("manual entries keep the full form enabled", () => {
    render(<ManualEntryDialog bookId="b1" accounts={accounts} entry={{ ...imported, source: "manual" } as BookkeepingLedgerEntry} open onOpenChange={() => {}} onSaved={() => {}} />)
    expect(screen.getByText("Edit entry")).toBeInTheDocument()
    expect(screen.getByLabelText(/amount/i)).toBeEnabled()
  })

  it("shows the source-aware caption for a receipt-source entry (title still 'Edit imported entry')", () => {
    render(
      <ManualEntryDialog
        bookId="b1"
        accounts={accounts}
        entry={{ ...imported, source: "receipt" } as BookkeepingLedgerEntry}
        open
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    )
    expect(screen.getByText("Edit imported entry")).toBeInTheDocument()
    expect(screen.getByText(/locked — from a posted receipt/i)).toBeInTheDocument()
  })

  it("saves a $0 locked entry — amount validation is skipped and the PATCH fires", async () => {
    const zeroAmountImported = { ...imported, amount_cents: 0 } as BookkeepingLedgerEntry
    render(
      <ManualEntryDialog bookId="b1" accounts={accounts} entry={zeroAmountImported} open onOpenChange={() => {}} onSaved={() => {}} />,
    )
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("/api/admin/bookkeeping/entries/e1")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(Object.keys(body).sort()).toEqual(["account_id", "business_purpose", "counterparty", "memo"])
  })
})
