import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ReceiptBatchReview } from "@/components/admin/bookkeeping/ReceiptBatchReview"
import { newReceiptRow, type ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
import type { BookkeepingAccount } from "@/types/database"

const accounts = [
  { id: "fuel", name: "Fuel", account_type: "expense", requires_business_purpose: false },
  { id: "meals", name: "Meals", account_type: "expense", requires_business_purpose: true },
] as BookkeepingAccount[]

function row(over: Partial<ReceiptBatchRow>): ReceiptBatchRow {
  return {
    ...newReceiptRow(over.clientId ?? "c1", "r.jpg", null),
    status: "scanned",
    documentId: "d1",
    included: true,
    counterparty: "Chevron",
    amount: "45.12",
    occurredOn: "2026-07-01",
    accountId: "fuel",
    previewUrl: "x",
    ...over,
  }
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

function renderReview(rows: ReceiptBatchRow[], over: Partial<Parameters<typeof ReceiptBatchReview>[0]> = {}) {
  const props = {
    rows,
    accounts,
    expandedId: null as string | null,
    posting: false,
    onExpand: vi.fn(),
    onToggleInclude: vi.fn(),
    onEditRow: vi.fn(),
    onPost: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  }
  return { ...render(<ReceiptBatchReview {...props} />), props }
}

describe("ReceiptBatchReview PDF rows", () => {
  it("shows a file tile instead of a broken image for a PDF row", () => {
    renderReview([
      row({ clientId: "p1", fileName: "invoice.pdf", isPdf: true, thumbUrl: "blob:mock" }),
    ])
    // A blob URL of a PDF in an <img> renders as a broken-image box.
    expect(document.querySelector('img[src="blob:mock"]')).toBeNull()
    expect(screen.getByLabelText("PDF")).toBeInTheDocument()
  })

  it("still renders the thumbnail for an image row", () => {
    renderReview([row({ clientId: "i1", fileName: "r.jpg", isPdf: false, thumbUrl: "blob:mock" })])
    expect(document.querySelector('img[src="blob:mock"]')).not.toBeNull()
  })
})

describe("ReceiptBatchReview", () => {
  it("summarizes count, ticked total, date range, and dupe count in the header", () => {
    renderReview([
      row({ clientId: "c1", amount: "10.00", occurredOn: "2026-07-01" }),
      row({ clientId: "c2", amount: "5.50", occurredOn: "2026-07-03" }),
      row({ clientId: "c3", amount: "99.00", included: false, duplicateUploadHint: "2026-07-10T00:00:00Z" }),
    ])
    expect(screen.getByText(/3 receipts/i)).toBeInTheDocument()
    expect(screen.getByText("$15.50")).toBeInTheDocument()
    expect(screen.getByText(/Jul 1, 2026 – Jul 3, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/1 possible duplicate/i)).toBeInTheDocument()
  })

  it("labels the footer with ticked count + total and posts on click", () => {
    const { props } = renderReview([row({ clientId: "c1" }), row({ clientId: "c2", included: false })])
    const btn = screen.getByRole("button", { name: /post 1 receipt \(\$45\.12\)/i })
    fireEvent.click(btn)
    expect(props.onPost).toHaveBeenCalled()
  })

  it("disables posting when a ticked row is invalid and badges the reason", () => {
    renderReview([row({ clientId: "c1", accountId: "meals", businessPurpose: "" })])
    expect(screen.getByRole("button", { name: /post 1 receipt/i })).toBeDisabled()
    expect(screen.getAllByText(/business purpose required/i).length).toBeGreaterThan(0)
  })

  it("switches to retry mode when an included row failed to post", () => {
    renderReview([
      row({ clientId: "c1", status: "posted" }),
      row({ clientId: "c2", status: "post_failed", error: "Month closed" }),
    ])
    expect(screen.getByRole("button", { name: /retry remaining \(1\)/i })).toBeInTheDocument()
    expect(screen.getByText("Month closed")).toBeInTheDocument()
  })

  it("badges duplicates and disables the checkbox on rows with nothing stored", () => {
    renderReview([
      row({ clientId: "c1" }),
      row({ clientId: "c2", included: false, withinBatchDupOf: 0 }),
      row({ clientId: "c3", included: false, status: "scan_failed", documentId: null, error: "Upload failed" }),
    ])
    expect(screen.getByText(/matches receipt #1/i)).toBeInTheDocument()
    const checkboxes = screen.getAllByRole("checkbox")
    expect(checkboxes[2]).toBeDisabled()
  })

  it("expands a row through onExpand", () => {
    const { props } = renderReview([row({ clientId: "c1" }), row({ clientId: "c2" })])
    fireEvent.click(screen.getAllByRole("button", { name: /edit receipt/i })[0])
    expect(props.onExpand).toHaveBeenCalledWith("c1")
  })

  it("renders the row editor for the expanded row", () => {
    renderReview([row({ clientId: "c1" })], { expandedId: "c1" })
    expect(screen.getByLabelText(/counterparty/i)).toHaveValue("Chevron")
  })
})
