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

describe("ReceiptUploadDialog (batch)", () => {
  it("renders the multi-select upload phase with the batch copy", () => {
    renderDialog()
    expect(screen.getByText(/upload receipt photos/i)).toBeInTheDocument()
    expect(screen.getByText(/up to 15 photos/i)).toBeInTheDocument()
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
})
