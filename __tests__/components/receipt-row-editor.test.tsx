import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { ReceiptRowEditor } from "@/components/admin/bookkeeping/ReceiptRowEditor"
import { newReceiptRow, type ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
import type { BookkeepingAccount } from "@/types/database"

const accounts = [
  { id: "meals", name: "Meals", account_type: "expense", requires_business_purpose: true },
  { id: "fuel", name: "Fuel", account_type: "expense", requires_business_purpose: false },
] as BookkeepingAccount[]

function row(over: Partial<ReceiptBatchRow>): ReceiptBatchRow {
  return {
    ...newReceiptRow("c1", "r.jpg", null),
    status: "scanned",
    documentId: "d1",
    counterparty: "Chevron",
    amount: "45.12",
    occurredOn: "2026-07-01",
    result: {
      vendor: "Chevron",
      amount_cents: 4512,
      occurred_on: "2026-07-01",
      suggested_category: "Fuel",
      business_purpose_hint: null,
      currency: "usd",
      confidence: "high",
      warnings: [],
    },
    ...over,
  }
}

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

describe("ReceiptRowEditor", () => {
  it("fetches the signed preview once on mount and reports it up", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://signed/img" }) })
    const onPreviewLoaded = vi.fn()
    render(
      <ReceiptRowEditor row={row({})} accounts={accounts} disabled={false} onEdit={() => {}} onPreviewLoaded={onPreviewLoaded} />,
    )
    await waitFor(() => expect(onPreviewLoaded).toHaveBeenCalledWith("https://signed/img"))
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/bookkeeping/documents/d1/download")
  })

  it("skips the fetch when previewUrl is already cached and renders it", () => {
    render(
      <ReceiptRowEditor
        row={row({ previewUrl: "https://signed/cached" })}
        accounts={accounts}
        disabled={false}
        onEdit={() => {}}
        onPreviewLoaded={() => {}}
      />,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByAltText("Receipt")).toHaveAttribute("src", "https://signed/cached")
  })

  it("shows warnings, the low-confidence banner, and the AI-scanned reference amount", () => {
    render(
      <ReceiptRowEditor
        row={row({
          previewUrl: "x",
          result: {
            vendor: "Chevron",
            amount_cents: 4512,
            occurred_on: "2026-07-01",
            suggested_category: null,
            business_purpose_hint: null,
            currency: null,
            confidence: "low",
            warnings: ["Total was glare-obscured"],
          },
        })}
        accounts={accounts}
        disabled={false}
        onEdit={() => {}}
        onPreviewLoaded={() => {}}
      />,
    )
    expect(screen.getByText("Total was glare-obscured")).toBeInTheDocument()
    expect(screen.getByText(/low-confidence read/i)).toBeInTheDocument()
    expect(screen.getByText(/AI scanned: \$45\.12/)).toBeInTheDocument()
  })

  it("marks business purpose required for flagged accounts and emits edits", () => {
    const onEdit = vi.fn()
    render(
      <ReceiptRowEditor
        row={row({ previewUrl: "x", accountId: "meals", businessPurpose: "" })}
        accounts={accounts}
        disabled={false}
        onEdit={onEdit}
        onPreviewLoaded={() => {}}
      />,
    )
    expect(screen.getByText(/business purpose required for this category/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/business purpose/i), { target: { value: "Client dinner" } })
    expect(onEdit).toHaveBeenCalledWith({ businessPurpose: "Client dinner" })
  })

  it("disables every field when disabled (posted rows lock)", () => {
    render(
      <ReceiptRowEditor
        row={row({ previewUrl: "x" })}
        accounts={accounts}
        disabled={true}
        onEdit={() => {}}
        onPreviewLoaded={() => {}}
      />,
    )
    expect(screen.getByLabelText(/amount/i)).toBeDisabled()
    expect(screen.getByLabelText(/date/i)).toBeDisabled()
    expect(screen.getByLabelText(/counterparty/i)).toBeDisabled()
  })
})
