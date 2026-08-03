import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { EmailReceiptsClient, readableFormatLabel } from "@/components/admin/bookkeeping/EmailReceiptsClient"
import { SCANNABLE_MIMES } from "@/lib/bookkeeping/receipt-attachments"
import type { BookkeepingAccount, BookkeepingBook, BookkeepingDocument } from "@/types/database"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const accounts = [
  { id: "equip", book_id: "b1", name: "Equipment", account_type: "expense", requires_business_purpose: false },
] as BookkeepingAccount[]

const books = [
  { id: "b1", name: "Darren — DJP Athlete", book_kind: "business", is_primary: true },
  { id: "b2", name: "Spouse — Business", book_kind: "business", is_primary: false },
  { id: "b3", name: "Household & Personal", book_kind: "household", is_primary: false },
] as BookkeepingBook[]

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

const scanResult = (over: Record<string, unknown> = {}) => ({
  vendor: "Home Depot", amount_cents: 12555, occurred_on: "2026-07-20",
  suggested_category: "Equipment", business_purpose_hint: null,
  currency: "USD", confidence: "high", warnings: [],
  ...over,
})

const base = {
  documents: [] as BookkeepingDocument[],
  books,
  accountsByBook: { b1: accounts, b2: [] as BookkeepingAccount[], b3: [] as BookkeepingAccount[] },
  connectionStatus: "connected" as string | null,
  label: "DJP Receipts",
  pollerEnabled: true,
  needsManualUpload: 0,
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
})

describe("EmailReceiptsClient empty state", () => {
  // The empty state once instructed the coach to "Label a receipt email with an
  // attached PDF or image" while SCANNABLE_MIMES excluded application/pdf, so
  // following that instruction imported NOTHING and the message was then
  // permanently settled — the receipt just vanished. PDF is genuinely supported
  // now, so the guard is no longer "never promise PDF" but "the promise on
  // screen matches the allow-list", which is what readableFormatLabel enforces.
  it("names exactly the formats the poller can actually read", () => {
    render(<EmailReceiptsClient {...base} />)
    const body = document.body.textContent ?? ""
    expect(body).toContain("JPEG, PNG, WEBP or PDF")
    expect(SCANNABLE_MIMES).toContain("application/pdf")
    // HEIC is the format that still cannot be read, and it must be named as
    // still needing a manual photo upload so a labeled iPhone photo is not
    // silently lost.
    expect(body).toMatch(/HEIC[^.]*photo upload/i)
  })

  it("tells the coach forwarding a body-only email now works", () => {
    render(<EmailReceiptsClient {...base} />)
    expect(screen.getByText(/forward a receipt email/i)).toBeInTheDocument()
    expect(screen.queryByText(/aren't imported|aren&apos;t imported/i)).not.toBeInTheDocument()
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
    expect(screen.getByText(/3 labeled emails carried a receipt/)).toBeInTheDocument()
  })

  it("shows nothing when there is no backlog", () => {
    render(<EmailReceiptsClient {...base} />)
    expect(screen.queryByText(/carried a receipt/)).not.toBeInTheDocument()
  })
})

describe("EmailReceiptsClient board", () => {
  it("renders the three triage columns and a back link to Accounting", () => {
    render(<EmailReceiptsClient {...base} documents={[doc({ scan_result: scanResult() })]} />)
    expect(screen.getByRole("heading", { name: "For review" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Needs a look" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Possible duplicates" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Accounting/ })).toHaveAttribute("href", "/admin/books")
  })

  // Migration 00193: documents with scan_result IS NULL must read as
  // "scan failed" so an ingested-but-never-scanned receipt cannot hide behind
  // a blank but confident-looking card. It lands in the attention column; the
  // full retry message lives in the detail dialog.
  it("flags an ingested-but-unscanned document as scan failed in Needs a look", () => {
    render(<EmailReceiptsClient {...base} documents={[doc()]} />)
    expect(screen.getByText("scan failed")).toBeInTheDocument()
    fireEvent.click(screen.getByTitle("Open details"))
    expect(screen.getByText("Scan failed — retry")).toBeInTheDocument()
    expect(screen.getByText(/Scan didn't finish/)).toBeInTheDocument()
  })

  it("a clean high-confidence scan lands in For review with amount and vendor on the card", () => {
    render(<EmailReceiptsClient {...base} documents={[doc({ scan_result: scanResult() })]} />)
    expect(screen.queryByText("Scan failed — retry")).not.toBeInTheDocument()
    expect(screen.getByText("Home Depot")).toBeInTheDocument()
    expect(screen.getByText("$125.55")).toBeInTheDocument()
    // The full editor is dialog-only now.
    fireEvent.click(screen.getByTitle("Open details"))
    expect(screen.getByDisplayValue("125.55")).toBeInTheDocument()
  })

  it("the later of two vendor+amount+date twins lands in Possible duplicates with a twin chip", () => {
    render(
      <EmailReceiptsClient
        {...base}
        documents={[
          doc({ id: "d1", scan_result: scanResult() }),
          doc({ id: "d2", external_ref: "gmail:m2:1", original_filename: "receipt-copy.pdf", scan_result: scanResult() }),
        ]}
      />,
    )
    expect(screen.getByText(/twin of/)).toBeInTheDocument()
  })

  it("posts with the document's own book by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ inserted: 1 }) })
    vi.stubGlobal("fetch", fetchMock)
    render(<EmailReceiptsClient {...base} documents={[doc({ scan_result: scanResult() })]} />)
    fireEvent.click(screen.getByRole("button", { name: /Post/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/admin/bookkeeping/receipts/commit")
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ book_id: "b1", document_id: "d1" })
    await waitFor(() => expect(screen.queryByText("Home Depot")).not.toBeInTheDocument())
  })

  it("Ignore calls the ignore endpoint and removes the card without posting", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ignored: true }) })
    vi.stubGlobal("fetch", fetchMock)
    render(<EmailReceiptsClient {...base} documents={[doc({ scan_result: scanResult() })]} />)
    fireEvent.click(screen.getByRole("button", { name: /Ignore/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/admin/bookkeeping/receipts/ignore")
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ document_id: "d1" })
    await waitFor(() => expect(screen.queryByText("Home Depot")).not.toBeInTheDocument())
  })

  it("every card carries a labeled book picker naming the target book", () => {
    render(<EmailReceiptsClient {...base} documents={[doc({ scan_result: scanResult() })]} />)
    const trigger = screen.getByLabelText("Post into book for receipt.jpg")
    expect(trigger).toHaveTextContent("Darren — DJP Athlete")
    expect(screen.getByText("Post into book")).toBeInTheDocument() // visible label, not just aria
  })
})
