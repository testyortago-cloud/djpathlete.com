// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { LedgerTable } from "@/components/admin/bookkeeping/LedgerTable"
import type { BookkeepingLedgerEntry } from "@/types/database"

function row(over: Partial<BookkeepingLedgerEntry>): BookkeepingLedgerEntry {
  return {
    id: "e1", book_id: "b1", account_id: null, direction: "income", amount_cents: 32000,
    occurred_on: "2026-07-01", memo: "Cannon Baller! — program purchase", counterparty: "Cannon Kremer",
    business_purpose: null, source: "platform_import", source_ref: "payments:p1", import_batch_id: null,
    document_id: null, adjusts_period: null, currency: "usd",
    created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
    ...over,
  } as BookkeepingLedgerEntry
}

describe("LedgerTable actions", () => {
  it("shows Edit on imported rows but Delete only on manual rows", () => {
    render(
      <LedgerTable
        rows={[row({ id: "imp", source: "platform_import" }), row({ id: "man", source: "manual" })]}
        accounts={[]}
        onChanged={() => {}}
        onEdit={() => {}}
      />,
    )
    expect(screen.getAllByTitle(/edit/i)).toHaveLength(2)
    expect(screen.getAllByTitle("Delete entry")).toHaveLength(1)
  })

  it("routes the imported row through onEdit", () => {
    const onEdit = vi.fn()
    render(<LedgerTable rows={[row({ id: "imp" })]} accounts={[]} onChanged={() => {}} onEdit={onEdit} />)
    screen.getByTitle("Edit imported entry").click()
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "imp" }))
  })
})
