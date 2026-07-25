import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { EmailReceiptsClient, readableFormatLabel } from "@/components/admin/bookkeeping/EmailReceiptsClient"
import { SCANNABLE_MIMES } from "@/lib/bookkeeping/receipt-attachments"
import type { BookkeepingAccount, BookkeepingDocument } from "@/types/database"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const accounts = [
  { id: "equip", book_id: "b1", name: "Equipment", account_type: "expense", requires_business_purpose: false },
] as BookkeepingAccount[]

const doc = (over: Partial<BookkeepingDocument> = {}) =>
  ({
    id: "d1",
    book_id: "b1",
    kind: "receipt",
    original_filename: "receipt.jpg",
    external_ref: "gmail:m1:2",
    posted_count: null,
    scan_result: null,
    ...over,
  }) as unknown as BookkeepingDocument

const base = {
  documents: [] as BookkeepingDocument[],
  accounts,
  connectionStatus: "connected" as string | null,
  label: "DJP Receipts",
  pollerEnabled: true,
  needsManualUpload: 0,
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
})

describe("EmailReceiptsClient empty state", () => {
  // The empty state used to instruct the coach to "Label a receipt email with
  // an attached PDF or image". SCANNABLE_MIMES deliberately excludes
  // application/pdf, so following that instruction imported NOTHING and the
  // message was then permanently settled — the receipt just vanished.
  it("never promises PDF support, and names the formats the poller can actually read", () => {
    render(<EmailReceiptsClient {...base} />)
    const body = document.body.textContent ?? ""
    expect(body).toContain("JPEG, PNG or WEBP")
    expect(body).not.toMatch(/PDF or image/i)
    // PDF may only be mentioned as an exclusion.
    expect(body).toMatch(/PDF attachments[^.]*aren't imported/i)
    expect(SCANNABLE_MIMES).not.toContain("application/pdf")
  })

  it("derives the format list from SCANNABLE_MIMES so the copy cannot drift from the code", () => {
    expect(readableFormatLabel(["image/jpeg", "image/png", "image/webp"])).toBe("JPEG, PNG or WEBP")
    expect(readableFormatLabel(["image/jpeg", "application/pdf"])).toBe("JPEG or PDF")
    expect(readableFormatLabel(["image/jpeg"])).toBe("JPEG")
  })

  it("says 'connect Gmail' only when no credentials exist — 'error' still retries hourly", () => {
    const { rerender } = render(<EmailReceiptsClient {...base} connectionStatus={null} />)
    expect(screen.getByText(/Connect Gmail in/)).toBeInTheDocument()
    rerender(<EmailReceiptsClient {...base} connectionStatus="error" />)
    expect(screen.queryByText(/Connect Gmail in/)).not.toBeInTheDocument()
    expect(screen.getByText(/authorization error on its last token refresh/)).toBeInTheDocument()
  })
})

describe("EmailReceiptsClient poller flag honesty", () => {
  // 00193 seeds cron_bookkeeping_gmail_receipts_enabled FALSE, so the shipping
  // default is "nothing will ever arrive", not "nothing has arrived yet".
  it("does not promise hourly imports while the cron flag is off", () => {
    render(<EmailReceiptsClient {...base} pollerEnabled={false} />)
    const body = document.body.textContent ?? ""
    expect(body).toContain("cron_bookkeeping_gmail_receipts_enabled")
    expect(body).toMatch(/turned off/i)
    expect(body).not.toMatch(/pulled hourly/i)
    expect(body).not.toMatch(/appears within the hour/i)
  })

  it("promises the hourly pull only when the flag is on", () => {
    render(<EmailReceiptsClient {...base} />)
    const body = document.body.textContent ?? ""
    expect(body).toMatch(/pulled hourly/i)
    expect(body).not.toContain("cron_bookkeeping_gmail_receipts_enabled")
  })
})

describe("EmailReceiptsClient unreadable backlog", () => {
  it("tells the coach about labeled emails the poller could not read", () => {
    render(<EmailReceiptsClient {...base} needsManualUpload={3} />)
    expect(screen.getByText(/3 labeled emails carried an attachment/)).toBeInTheDocument()
  })

  it("shows nothing when there is no backlog", () => {
    render(<EmailReceiptsClient {...base} />)
    expect(screen.queryByText(/carried an attachment/)).not.toBeInTheDocument()
  })
})

describe("EmailReceiptsClient rows", () => {
  // Migration 00193: documents with scan_result IS NULL must read as
  // "scan failed — retry" so an ingested-but-never-scanned receipt cannot hide
  // behind a blank but confident-looking "scanned" row.
  it("flags an ingested-but-unscanned document as scan failed", () => {
    render(<EmailReceiptsClient {...base} documents={[doc()]} />)
    expect(screen.getByText("Scan failed — retry")).toBeInTheDocument()
    expect(screen.getByText(/Scan didn't finish/)).toBeInTheDocument()
    // Still postable by hand.
    expect(screen.getByRole("button", { name: /Post/ })).toBeEnabled()
  })

  it("a real scan renders no failure banner", () => {
    const scanned = doc({
      scan_result: {
        vendor: "Home Depot", amount_cents: 12555, occurred_on: "2026-07-20",
        suggested_category: "Equipment", business_purpose_hint: null,
        currency: "USD", confidence: "high", warnings: [],
      },
    } as Partial<BookkeepingDocument>)
    render(<EmailReceiptsClient {...base} documents={[scanned]} />)
    expect(screen.queryByText("Scan failed — retry")).not.toBeInTheDocument()
    expect(screen.getByDisplayValue("125.55")).toBeInTheDocument()
  })
})
