import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const insertImportedEntriesMock = vi.fn()
const linkDocumentBatchMock = vi.fn()
const recordAuditMock = vi.fn()
const assertAccountsInBookMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))
vi.mock("@/lib/db/bookkeeping", () => ({
  insertImportedEntries: (...a: unknown[]) => insertImportedEntriesMock(...a),
  linkDocumentBatch: (...a: unknown[]) => linkDocumentBatchMock(...a),
  assertAccountsInBook: (...a: unknown[]) => assertAccountsInBookMock(...a),
}))

import { POST as COMMIT } from "@/app/api/admin/bookkeeping/statement-import/commit/route"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const DOC = "d0000000-0000-4000-8000-000000000002"
const VALID_REF = "statement:" + "a".repeat(40)

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    direction: "income", amount_cents: 5000, occurred_on: "2026-03-02", memo: "x",
    counterparty: "a@b.com", service_line: "performance_training",
    source: "statement_import", source_ref: VALID_REF,
    ...overrides,
  }
}

beforeEach(() => {
  authMock.mockReset(); insertImportedEntriesMock.mockReset(); linkDocumentBatchMock.mockReset(); recordAuditMock.mockReset()
  assertAccountsInBookMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  assertAccountsInBookMock.mockResolvedValue(undefined)
})

describe("statement-import commit", () => {
  it("403s non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await COMMIT(new Request("http://x", { method: "POST", body: JSON.stringify({
      book_id: BOOK, entries: [makeEntry()] }) }) as never)
    expect(res.status).toBe(403)
    expect(insertImportedEntriesMock).not.toHaveBeenCalled()
  })

  it("400s a mangled statement_import source_ref", async () => {
    const entries = [makeEntry({ source_ref: "statement:xyz" })]
    const res = await COMMIT(new Request("http://x", { method: "POST", body: JSON.stringify({
      book_id: BOOK, entries }) }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid statement source_ref")
    expect(insertImportedEntriesMock).not.toHaveBeenCalled()
  })

  it("400s another mangled source_ref shape (wrong prefix)", async () => {
    const entries = [makeEntry({ source_ref: "payments:1" })]
    const res = await COMMIT(new Request("http://x", { method: "POST", body: JSON.stringify({
      book_id: BOOK, entries }) }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid statement source_ref")
    expect(insertImportedEntriesMock).not.toHaveBeenCalled()
  })

  it("happy path: posts entries, links document batch, returns inserted + batchId", async () => {
    insertImportedEntriesMock.mockResolvedValue({ inserted: 1 })
    const entries = [makeEntry()]
    const res = await COMMIT(new Request("http://x", { method: "POST", body: JSON.stringify({
      book_id: BOOK, entries, document_id: DOC }) }) as never)
    expect(res.status).toBe(200)
    expect(insertImportedEntriesMock).toHaveBeenCalledWith(BOOK, expect.any(String), entries)
    const batchIdArg = insertImportedEntriesMock.mock.calls[0][1]
    expect(linkDocumentBatchMock).toHaveBeenCalledWith(DOC, BOOK, batchIdArg, 1)
    const json = await res.json()
    expect(json.inserted).toBe(1)
    expect(json.batchId).toBe(batchIdArg)
  })

  it("no document_id: linkDocumentBatch is not called", async () => {
    insertImportedEntriesMock.mockResolvedValue({ inserted: 1 })
    const entries = [makeEntry()]
    const res = await COMMIT(new Request("http://x", { method: "POST", body: JSON.stringify({
      book_id: BOOK, entries }) }) as never)
    expect(res.status).toBe(200)
    expect(linkDocumentBatchMock).not.toHaveBeenCalled()
  })
})
