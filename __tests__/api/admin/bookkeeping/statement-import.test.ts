import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const createDocumentMock = vi.fn()
const findDocumentBySha256Mock = vi.fn()
const listAccountsMock = vi.fn()
const getBookMock = vi.fn()
const createGenerationLogMock = vi.fn()
const storeStatementFileMock = vi.fn()
const recordAuditMock = vi.fn()
const jobSet = vi.fn(async (_doc: Record<string, unknown>) => {})
const rtdbSet = vi.fn(async (_doc: Record<string, unknown>) => {})

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))
vi.mock("@/lib/db/bookkeeping", () => ({
  createDocument: (...a: unknown[]) => createDocumentMock(...a),
  findDocumentBySha256: (...a: unknown[]) => findDocumentBySha256Mock(...a),
  listAccounts: (...a: unknown[]) => listAccountsMock(...a),
  getBook: (...a: unknown[]) => getBookMock(...a),
}))
vi.mock("@/lib/bookkeeping/documents", () => ({
  safeStatementName: (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_"),
  storeStatementFile: (...a: unknown[]) => storeStatementFileMock(...a),
}))
vi.mock("@/lib/db/ai-generation-log", () => ({
  createGenerationLog: (...a: unknown[]) => createGenerationLogMock(...a),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ id: "job-1", set: jobSet }) }) }),
  getAdminRtdb: () => ({ ref: () => ({ set: rtdbSet }) }),
}))
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "ts" } }))

import { POST } from "@/app/api/admin/bookkeeping/statement-import/route"

const BOOK = "b0000000-0000-4000-8000-000000000001"

interface FileLike {
  name: string
  type: string
  size: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

function fileLike(overrides: Partial<{ name: string; type: string; text: string; size: number }> = {}): FileLike {
  const text = overrides.text ?? "date,description,amount\n2026-01-01,Coffee Shop,-5.00\n2026-01-02,Paycheck,1500.00\n"
  const buf = Buffer.from(text, "utf8")
  return {
    name: overrides.name ?? "statement.csv",
    type: overrides.type ?? "text/csv",
    size: overrides.size ?? buf.byteLength,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  }
}

function fakeRequest(fields: Record<string, unknown>): Request {
  const map = new Map<string, unknown>(Object.entries(fields))
  return { formData: async () => map } as unknown as Request
}

/** CSV with `n` distinct, non-transfer, non-balance transaction rows. */
function bigCsv(n: number): string {
  const header = "date,description,amount"
  const lines = Array.from({ length: n }, (_, i) => {
    const day = String((i % 28) + 1).padStart(2, "0")
    return `2026-01-${day},Txn ${i},-1.00`
  })
  return [header, ...lines].join("\n") + "\n"
}

beforeEach(() => {
  authMock.mockReset()
  createDocumentMock.mockReset()
  findDocumentBySha256Mock.mockReset()
  listAccountsMock.mockReset()
  getBookMock.mockReset()
  createGenerationLogMock.mockReset()
  storeStatementFileMock.mockReset()
  recordAuditMock.mockReset()
  jobSet.mockClear()
  rtdbSet.mockClear()

  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  findDocumentBySha256Mock.mockResolvedValue(null)
  listAccountsMock.mockResolvedValue([
    { id: "acc-1", book_id: BOOK, name: "Coaching income", account_type: "income", service_line: "performance_training" },
  ])
  getBookMock.mockResolvedValue({ id: BOOK, name: "Main Book", book_kind: "business" })
  createDocumentMock.mockResolvedValue({ id: "doc-1", created_at: "2026-07-18T00:00:00Z" })
  createGenerationLogMock.mockResolvedValue({ id: "log-1" })
  storeStatementFileMock.mockResolvedValue(undefined)
})

describe("POST /api/admin/bookkeeping/statement-import", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(fakeRequest({ file: fileLike(), book_id: BOOK }) as never)
    expect(res.status).toBe(403)
    expect(createDocumentMock).not.toHaveBeenCalled()
  })

  it("400s when no file is provided", async () => {
    const res = await POST(fakeRequest({ book_id: BOOK }) as never)
    expect(res.status).toBe(400)
    expect(createDocumentMock).not.toHaveBeenCalled()
  })

  it("400s on an unsupported file type", async () => {
    const res = await POST(
      fakeRequest({ file: fileLike({ name: "statement.zip", type: "application/zip" }), book_id: BOOK }) as never,
    )
    expect(res.status).toBe(400)
    expect(createDocumentMock).not.toHaveBeenCalled()
  })

  it("400s on an oversized file", async () => {
    const res = await POST(
      fakeRequest({ file: fileLike({ size: 11 * 1024 * 1024 }), book_id: BOOK }) as never,
    )
    expect(res.status).toBe(400)
    expect(createDocumentMock).not.toHaveBeenCalled()
  })

  it("202s with jobId/documentId/log_id for a valid CSV", async () => {
    const res = await POST(fakeRequest({ file: fileLike(), book_id: BOOK }) as never)
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json.jobId).toBe("job-1")
    expect(json.documentId).toBe("doc-1")
    expect(json.log_id).toBe("log-1")
    expect(json.duplicateUploadHint).toBeNull()

    expect(createDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ book_id: BOOK, kind: "statement", sha256: expect.any(String), uploaded_by: "admin-1" }),
    )
    expect(jobSet).toHaveBeenCalledOnce()
    const jobDoc = jobSet.mock.calls[0][0] as {
      type: string
      input: { kind: string; rows: { ref: string }[]; documentId: string; logId: string }
    }
    expect(jobDoc.type).toBe("statement_import")
    expect(jobDoc.input.kind).toBe("csv_structured")
    expect(jobDoc.input.rows).toHaveLength(2)
    expect(jobDoc.input.rows[0].ref).toBe("0")
    expect(jobDoc.input.documentId).toBe("doc-1")
    expect(jobDoc.input.logId).toBe("log-1")
    expect(rtdbSet).toHaveBeenCalledOnce()
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bookkeeping.statement_uploaded", target: { type: "bookkeeping_document", id: "doc-1" } }),
    )
  })

  it("falls back to csv_raw when the columns cannot be detected", async () => {
    const res = await POST(
      fakeRequest({ file: fileLike({ text: "not,a,recognizable,header\nfoo,bar,baz,qux\n" }), book_id: BOOK }) as never,
    )
    expect(res.status).toBe(202)
    const jobDoc = jobSet.mock.calls[0][0] as { input: { kind: string; rawText: string; rows: unknown } }
    expect(jobDoc.input.kind).toBe("csv_raw")
    expect(jobDoc.input.rawText).toContain("not,a,recognizable,header")
  })

  it("sets duplicateUploadHint when findDocumentBySha256 returns a prior row", async () => {
    findDocumentBySha256Mock.mockResolvedValue({ id: "doc-old", created_at: "2026-05-01T12:00:00Z" })
    const res = await POST(fakeRequest({ file: fileLike(), book_id: BOOK }) as never)
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json.duplicateUploadHint).toBe("2026-05-01T12:00:00Z")
  })

  it("returns a friendly 500 when statement storage is not configured", async () => {
    vi.stubEnv("FIREBASE_PRIVATE_BUCKET", "")
    const res = await POST(fakeRequest({ file: fileLike(), book_id: BOOK }) as never)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/statement storage not configured/i)
    vi.unstubAllEnvs()
  })

  it("400s on an empty file", async () => {
    const res = await POST(fakeRequest({ file: fileLike({ text: "" }), book_id: BOOK }) as never)
    expect(res.status).toBe(400)
    expect(createDocumentMock).not.toHaveBeenCalled()
  })

  it("caps csv_structured rows at 500, surfaces a truncation warning, and records the TRUE row_count on the document", async () => {
    const res = await POST(fakeRequest({ file: fileLike({ text: bigCsv(640) }), book_id: BOOK }) as never)
    expect(res.status).toBe(202)

    expect(createDocumentMock).toHaveBeenCalledWith(expect.objectContaining({ row_count: 640 }))

    const jobDoc = jobSet.mock.calls[0][0] as {
      input: { kind: string; rows: unknown[]; uploadWarnings: string[]; uploadTruncated: boolean }
    }
    expect(jobDoc.input.kind).toBe("csv_structured")
    expect(jobDoc.input.rows).toHaveLength(500)
    expect(jobDoc.input.uploadTruncated).toBe(true)
    expect(
      jobDoc.input.uploadWarnings.some((w) => w.includes("640") && w.includes("500")),
    ).toBe(true)
  })
})
