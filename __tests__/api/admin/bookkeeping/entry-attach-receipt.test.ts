import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getEntryMock = vi.fn()
const updateEntryMock = vi.fn()
const createDocumentMock = vi.fn()
const deleteDocumentMock = vi.fn()
const storeStatementFileMock = vi.fn()
const deleteStatementFileMock = vi.fn()
const recordAuditMock = vi.fn()
const pdfRejectionMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))
vi.mock("@/lib/db/bookkeeping", () => ({
  getEntry: (...a: unknown[]) => getEntryMock(...a),
  updateEntry: (...a: unknown[]) => updateEntryMock(...a),
  createDocument: (...a: unknown[]) => createDocumentMock(...a),
  deleteDocument: (...a: unknown[]) => deleteDocumentMock(...a),
}))
vi.mock("@/lib/bookkeeping/documents", () => ({
  safeStatementName: (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_"),
  storeStatementFile: (...a: unknown[]) => storeStatementFileMock(...a),
  deleteStatementFile: (...a: unknown[]) => deleteStatementFileMock(...a),
}))
vi.mock("@/lib/bookkeeping/receipt-pdf", () => ({
  isPdfUpload: (type: string, name: string) => type === "application/pdf" || name.toLowerCase().endsWith(".pdf"),
  pdfRejectionReasonForBuffer: (...a: unknown[]) => pdfRejectionMock(...a),
}))
// receiptRetainUntil stays REAL — the retention year is the thing under test.

import { POST } from "@/app/api/admin/bookkeeping/entries/[id]/receipt/route"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ENTRY = "e0000000-0000-4000-8000-000000000001"

function fileLike(over: Partial<{ name: string; type: string; size: number; bytes: string }> = {}) {
  const buf = Buffer.from(over.bytes ?? "jpegbytes", "utf8")
  return {
    name: over.name ?? "receipt.jpg",
    type: over.type ?? "image/jpeg",
    size: over.size ?? buf.byteLength,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  }
}

function req(fields: Record<string, unknown>): Request {
  const map = new Map<string, unknown>(Object.entries(fields))
  return { formData: async () => map } as unknown as Request
}

const ctx = { params: Promise.resolve({ id: ENTRY }) }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FIREBASE_PRIVATE_BUCKET = "test-private-bucket"
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  // An Amazon import — the shape the watchdog nags about. The year MUST differ
  // from the current year: with a same-year entry, retain-from-entry and
  // retain-from-today produce the identical string and the retention assertion
  // below cannot fail (caught by mutation probe, 2026-08-04).
  getEntryMock.mockResolvedValue({
    id: ENTRY,
    book_id: BOOK,
    occurred_on: "2024-11-02",
    direction: "expense",
    source: "receipt",
    document_id: null,
  })
  createDocumentMock.mockResolvedValue({ id: "doc-1" })
  updateEntryMock.mockResolvedValue({ id: ENTRY, document_id: "doc-1" })
  storeStatementFileMock.mockResolvedValue(undefined)
  deleteStatementFileMock.mockResolvedValue(undefined)
  deleteDocumentMock.mockResolvedValue(undefined)
  pdfRejectionMock.mockResolvedValue(null)
})

describe("POST /api/admin/bookkeeping/entries/[id]/receipt", () => {
  it("403s a non-admin and stores nothing", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req({ file: fileLike() }), ctx)
    expect(res.status).toBe(403)
    expect(storeStatementFileMock).not.toHaveBeenCalled()
  })

  it("404s an unknown entry before touching storage", async () => {
    getEntryMock.mockResolvedValue(null)
    const res = await POST(req({ file: fileLike() }), ctx)
    expect(res.status).toBe(404)
    expect(storeStatementFileMock).not.toHaveBeenCalled()
  })

  it("attaches the document to the EXISTING entry and retains from the entry's year, not today's", async () => {
    const res = await POST(req({ file: fileLike() }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ entry: { id: ENTRY, document_id: "doc-1" }, document_id: "doc-1" })

    // The IRS clock runs from when the money moved: 2024 entry → 2031-12-31,
    // NOT (current year + 7), which is what stamping from today would give.
    expect(createDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ book_id: BOOK, kind: "receipt", retain_until: "2031-12-31", row_count: 1 }),
    )
    // The entry is UPDATED — no second ledger row is created for the receipt.
    expect(updateEntryMock).toHaveBeenCalledWith(ENTRY, { document_id: "doc-1" })
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bookkeeping.receipt_uploaded", category: "commerce" }),
    )
  })

  it("stores under the entry's own book, never a client-supplied one", async () => {
    await POST(req({ file: fileLike({ name: "my receipt!.jpg" }), book_id: "b9999999-9999-4999-8999-999999999999" }), ctx)
    const [path] = storeStatementFileMock.mock.calls[0] as [string]
    expect(path).toContain(`bookkeeping/receipts/${BOOK}/`)
    expect(path).toContain("my_receipt_.jpg")
  })

  it("400s an oversized file and a disallowed type", async () => {
    expect((await POST(req({ file: fileLike({ size: 11 * 1024 * 1024 }) }), ctx)).status).toBe(400)
    expect((await POST(req({ file: fileLike({ name: "notes.txt", type: "text/plain" }) }), ctx)).status).toBe(400)
    expect((await POST(req({}), ctx)).status).toBe(400)
    expect(storeStatementFileMock).not.toHaveBeenCalled()
  })

  it("400s a PDF the page-cap rejects", async () => {
    pdfRejectionMock.mockResolvedValue("PDF has too many pages")
    const res = await POST(req({ file: fileLike({ name: "r.pdf", type: "application/pdf" }) }), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("PDF has too many pages")
    expect(createDocumentMock).not.toHaveBeenCalled()
  })

  it("a closed period 409s AND cleans up both the document row and the stored bytes", async () => {
    updateEntryMock.mockRejectedValue(Object.assign(new Error("closed"), { code: "PERIOD_CLOSED" }))
    const res = await POST(req({ file: fileLike() }), ctx)
    expect(res.status).toBe(409)
    // An orphan is billed forever and is undeleted PII.
    expect(deleteDocumentMock).toHaveBeenCalledWith("doc-1")
    expect(deleteStatementFileMock).toHaveBeenCalledTimes(1)
    expect(recordAuditMock).not.toHaveBeenCalled()
  })

  it("cleans up the stored bytes when the document row itself fails to insert", async () => {
    createDocumentMock.mockRejectedValue(new Error("postgrest boom"))
    const res = await POST(req({ file: fileLike() }), ctx)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain("boom")
    expect(deleteStatementFileMock).toHaveBeenCalledTimes(1)
    expect(deleteDocumentMock).not.toHaveBeenCalled() // there was no row to remove
  })
})
