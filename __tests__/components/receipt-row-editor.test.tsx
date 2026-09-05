// @vitest-environment jsdom
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

describe("ReceiptRowEditor PDF preview", () => {
  it("renders a PDF in an iframe, not an img, with an open-in-new-tab fallback", () => {
    render(
      <ReceiptRowEditor
        row={row({ isPdf: true, fileName: "invoice.pdf", previewUrl: "https://signed/doc.pdf" })}
        accounts={accounts}
        disabled={false}
        onEdit={() => {}}
        onPreviewLoaded={() => {}}
      />,
    )
    expect(document.querySelector('iframe[src="https://signed/doc.pdf"]')).not.toBeNull()
    expect(document.querySelector('img[src="https://signed/doc.pdf"]')).toBeNull()
    // The DURABLE admin route, never the raw signed URL: a signed URL kept in a
    // tab rots into GCS ExpiredToken XML after its TTL (2026-08-03 report).
    expect(screen.getByRole("link", { name: /open in new tab/i })).toHaveAttribute(
      "href",
      "/api/admin/bookkeeping/documents/d1/download?redirect=1",
    )
  })

  it("never frames a blob thumbUrl while the signed URL is still loading", () => {
    // previewUrl null means the lazy signed-URL fetch fires; leave it pending
    // so this asserts the state BEFORE the signed URL arrives.
    fetchMock.mockReturnValue(new Promise(() => {}))
    render(
      <ReceiptRowEditor
        row={row({ isPdf: true, fileName: "invoice.pdf", previewUrl: null, thumbUrl: "blob:mock" })}
        accounts={accounts}
        disabled={false}
        onEdit={() => {}}
        onPreviewLoaded={() => {}}
      />,
    )
    expect(document.querySelector("iframe")).toBeNull()
    // The blob URL must never reach an <img> either — a PDF there is a
    // broken-image box, which is the bug this whole branch exists to avoid.
    expect(document.querySelector('img[src="blob:mock"]')).toBeNull()
  })

  it("falls back to the filename when a PDF has no signed URL to frame", () => {
    // documentId null → no fetch, so previewLoading stays false.
    render(
      <ReceiptRowEditor
        row={row({
          isPdf: true,
          fileName: "invoice.pdf",
          documentId: null,
          previewUrl: null,
          thumbUrl: "blob:mock",
        })}
        accounts={accounts}
        disabled={false}
        onEdit={() => {}}
        onPreviewLoaded={() => {}}
      />,
    )
    expect(document.querySelector("iframe")).toBeNull()
    expect(document.querySelector('img[src="blob:mock"]')).toBeNull()
    expect(screen.getByText("invoice.pdf")).toBeInTheDocument()
  })

  it("still renders an img for a photo row", () => {
    render(
      <ReceiptRowEditor
        row={row({ isPdf: false, previewUrl: "https://signed/img" })}
        accounts={accounts}
        disabled={false}
        onEdit={() => {}}
        onPreviewLoaded={() => {}}
      />,
    )
    expect(document.querySelector('img[src="https://signed/img"]')).not.toBeNull()
    expect(document.querySelector("iframe")).toBeNull()
  })
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
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
    expect(screen.getByLabelText(/business purpose/i)).toBeDisabled()
    expect(screen.getByLabelText(/category/i)).toBeDisabled()
  })
})
