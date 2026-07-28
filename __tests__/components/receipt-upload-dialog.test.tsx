import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"

const listeners = new Map<string, { cb: (snap: { val: () => unknown }) => void }>()
vi.mock("@/lib/firebase", () => ({ rtdb: {} }))
vi.mock("firebase/database", () => ({
  ref: vi.fn((_db: unknown, path: string) => ({ path })),
  onValue: vi.fn((r: { path: string }, cb: (snap: { val: () => unknown }) => void) => {
    listeners.set(r.path, { cb })
  }),
  off: vi.fn(),
}))
vi.mock("@/hooks/use-ai-jobs-dock", () => ({ useAiJobsDock: () => ({ addJob: vi.fn() }) }))

import { ReceiptUploadDialog } from "@/components/admin/bookkeeping/ReceiptUploadDialog"
import type { BookkeepingAccount } from "@/types/database"

const accounts = [
  { id: "fuel", name: "Fuel", account_type: "expense", requires_business_purpose: false },
] as BookkeepingAccount[]

const fetchMock = vi.fn()
beforeEach(() => {
  listeners.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  URL.createObjectURL = vi.fn(() => "blob:mock") as never
  URL.revokeObjectURL = vi.fn() as never
})

function makeFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" })
}

function renderDialog(over: Partial<Parameters<typeof ReceiptUploadDialog>[0]> = {}) {
  const props = {
    bookId: "b1",
    bookName: "DJP Athlete",
    accounts,
    open: true,
    onOpenChange: vi.fn(),
    onSaved: vi.fn(),
    ...over,
  }
  return { ...render(<ReceiptUploadDialog {...props} />), props }
}

function pickFiles(files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

function makePdf(name = "invoice.pdf"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" })
}

function dropFiles(files: File[]) {
  const zone = screen.getByTestId("receipt-dropzone")
  fireEvent.drop(zone, { dataTransfer: { files, types: ["Files"] } })
}

describe("ReceiptUploadDialog drag and drop", () => {
  it("adds dropped files to the batch", () => {
    renderDialog()
    dropFiles([makeFile("dropped.jpg")])
    expect(screen.getByText("dropped.jpg")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /upload & scan/i })).toBeEnabled()
  })

  it("accepts a dropped PDF", () => {
    renderDialog()
    dropFiles([makePdf()])
    expect(screen.getByText("invoice.pdf")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /upload & scan/i })).toBeEnabled()
  })

  it("rejects a dropped non-receipt file and adds nothing", () => {
    renderDialog()
    dropFiles([new File(["x"], "notes.docx", { type: "application/msword" })])
    expect(screen.queryByText("notes.docx")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /upload & scan/i })).toBeDisabled()
  })

  it("keeps the good files from a mixed drop", () => {
    renderDialog()
    dropFiles([makeFile("a.jpg"), new File(["x"], "notes.docx", { type: "application/msword" }), makePdf()])
    expect(screen.getByText("a.jpg")).toBeInTheDocument()
    expect(screen.getByText("invoice.pdf")).toBeInTheDocument()
    expect(screen.queryByText("notes.docx")).not.toBeInTheDocument()
  })

  it("lets a second batch be dropped once files are staged", () => {
    renderDialog()
    pickFiles([makeFile("first.jpg")])
    dropFiles([makeFile("second.jpg")])
    expect(screen.getByText("first.jpg")).toBeInTheDocument()
    expect(screen.getByText("second.jpg")).toBeInTheDocument()
  })

  it("advertises PDF support in the copy and the accept attribute", () => {
    renderDialog()
    expect(screen.getByText(/JPG, PNG, WEBP, or PDF/i)).toBeInTheDocument()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.getAttribute("accept")).toContain("application/pdf")
  })

  it("keeps the dropzone reachable by keyboard", () => {
    renderDialog()
    const zone = screen.getByTestId("receipt-dropzone").firstElementChild as HTMLElement
    expect(zone).toHaveAttribute("role", "button")
    expect(zone).toHaveAttribute("tabindex", "0")
  })
})

describe("ReceiptUploadDialog (batch)", () => {
  it("renders the multi-select upload phase with the batch copy", () => {
    renderDialog()
    expect(screen.getByText(/upload receipt photos/i)).toBeInTheDocument()
    expect(screen.getByText(/up to 15 files/i)).toBeInTheDocument()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toHaveAttribute("multiple")
    expect(screen.getByRole("button", { name: /upload & scan/i })).toBeDisabled()
  })

  it("lists picked files with remove buttons and counts the scan button", () => {
    renderDialog()
    pickFiles([makeFile("a.jpg"), makeFile("b.jpg")])
    expect(screen.getByText("a.jpg")).toBeInTheDocument()
    expect(screen.getByText("b.jpg")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /upload & scan 2 receipts/i })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: /remove a\.jpg/i }))
    expect(screen.queryByText("a.jpg")).not.toBeInTheDocument()
  })

  it("walks a single receipt through scanning into an auto-expanded one-row review", async () => {
    renderDialog()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ jobId: "j1", documentId: "d1", duplicateUploadHint: null }),
    })
    pickFiles([makeFile("a.jpg")])
    fireEvent.click(screen.getByRole("button", { name: /upload & scan/i }))
    await waitFor(() => expect(listeners.has("ai_jobs/j1")).toBe(true))
    expect(screen.getByText(/scanned 0 of 1/i)).toBeInTheDocument()

    // Preview fetch for the auto-expanded editor
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://signed/img" }) })
    act(() => {
      listeners.get("ai_jobs/j1")!.cb({
        val: () => ({
          status: "completed",
          result: { vendor: "Chevron", amount_cents: 4512, occurred_on: "2026-07-01", suggested_category: "Fuel" },
        }),
      })
    })
    await waitFor(() => expect(screen.getByLabelText(/counterparty/i)).toHaveValue("Chevron"))
    expect(screen.getByRole("button", { name: /post 1 receipt \(\$45\.12\)/i })).toBeEnabled()
  })

  it("blocks dismissal while scanning", async () => {
    const { props } = renderDialog()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ jobId: "j1", documentId: "d1", duplicateUploadHint: null }),
    })
    pickFiles([makeFile("a.jpg")])
    fireEvent.click(screen.getByRole("button", { name: /upload & scan/i }))
    await waitFor(() => expect(listeners.has("ai_jobs/j1")).toBe(true))
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("posts the batch and fires onSaved + close through onAllPosted", async () => {
    const { props } = renderDialog()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ jobId: "j1", documentId: "d1", duplicateUploadHint: null }),
    })
    pickFiles([makeFile("a.jpg")])
    fireEvent.click(screen.getByRole("button", { name: /upload & scan/i }))
    await waitFor(() => expect(listeners.has("ai_jobs/j1")).toBe(true))
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://signed/img" }) })
    act(() => {
      listeners.get("ai_jobs/j1")!.cb({
        val: () => ({
          status: "completed",
          result: { vendor: "Chevron", amount_cents: 4512, occurred_on: "2026-07-01", suggested_category: "Fuel" },
        }),
      })
    })
    await waitFor(() => expect(screen.getByRole("button", { name: /post 1 receipt/i })).toBeEnabled())
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ inserted: 1 }) })
    fireEvent.click(screen.getByRole("button", { name: /post 1 receipt/i }))
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled())
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows a persistent Upload Failed banner when every upload fails", async () => {
    renderDialog()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "File too large. Maximum 10 MB" }) })
    pickFiles([makeFile("huge.jpg")])
    fireEvent.click(screen.getByRole("button", { name: /upload & scan/i }))
    await waitFor(() => expect(screen.getByText(/upload failed/i)).toBeInTheDocument())
    expect(screen.getByText(/file too large/i)).toBeInTheDocument()
  })

  it("fires onSaved exactly once when closing after a partial post, and never with zero posted", async () => {
    const { props, unmount } = renderDialog()
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ jobId: "j1", documentId: "d1", duplicateUploadHint: null }) })
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ jobId: "j2", documentId: "d2", duplicateUploadHint: null }) })
    pickFiles([makeFile("a.jpg"), makeFile("b.jpg")])
    fireEvent.click(screen.getByRole("button", { name: /upload & scan/i }))
    await waitFor(() => expect(listeners.has("ai_jobs/j2")).toBe(true))
    act(() => {
      listeners.get("ai_jobs/j1")!.cb({ val: () => ({ status: "completed", result: { vendor: "Chevron", amount_cents: 4512, occurred_on: "2026-07-01", suggested_category: "Fuel" } }) })
    })
    act(() => {
      listeners.get("ai_jobs/j2")!.cb({ val: () => ({ status: "completed", result: { vendor: "HEB", amount_cents: 2000, occurred_on: "2026-07-02", suggested_category: "Fuel" } }) })
    })
    await waitFor(() => expect(screen.getByRole("button", { name: /post 2 receipts/i })).toBeEnabled())
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ inserted: 1 }) })
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: "business_purpose required for this category" }) })
    fireEvent.click(screen.getByRole("button", { name: /post 2 receipts/i }))
    await waitFor(() => expect(screen.getByRole("button", { name: /retry remaining \(1\)/i })).toBeInTheDocument())
    expect(props.onSaved).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }))
    expect(props.onSaved).toHaveBeenCalledTimes(1)
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    unmount()

    // zero-posted control: fresh dialog straight to review, close without posting
    vi.clearAllMocks()
    listeners.clear()
    const second = renderDialog()
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ jobId: "j9", documentId: "d9", duplicateUploadHint: null }) })
    pickFiles([makeFile("c.jpg")])
    fireEvent.click(screen.getByRole("button", { name: /upload & scan/i }))
    await waitFor(() => expect(listeners.has("ai_jobs/j9")).toBe(true))
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://signed/img" }) })
    act(() => {
      listeners.get("ai_jobs/j9")!.cb({ val: () => ({ status: "completed", result: { vendor: "HEB", amount_cents: 2000, occurred_on: "2026-07-02", suggested_category: "Fuel" } }) })
    })
    await waitFor(() => expect(screen.getByRole("button", { name: /post 1 receipt/i })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }))
    expect(second.props.onSaved).not.toHaveBeenCalled()
    expect(second.props.onOpenChange).toHaveBeenCalledWith(false)
  })
})
