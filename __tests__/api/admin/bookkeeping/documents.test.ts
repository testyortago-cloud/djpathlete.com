import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const listDocumentsMock = vi.fn()
const getDocumentMock = vi.fn()
const deleteDocumentMock = vi.fn()
const deleteStatementFileMock = vi.fn()
const signStatementDownloadMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listDocuments: (...a: unknown[]) => listDocumentsMock(...a),
  getDocument: (...a: unknown[]) => getDocumentMock(...a),
  deleteDocument: (...a: unknown[]) => deleteDocumentMock(...a),
}))
vi.mock("@/lib/bookkeeping/documents", () => ({
  deleteStatementFile: (...a: unknown[]) => deleteStatementFileMock(...a),
  signStatementDownload: (...a: unknown[]) => signStatementDownloadMock(...a),
}))

import { GET as GET_LIST } from "@/app/api/admin/bookkeeping/documents/route"
import { DELETE } from "@/app/api/admin/bookkeeping/documents/[id]/route"
import { GET as GET_DOWNLOAD } from "@/app/api/admin/bookkeeping/documents/[id]/download/route"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const DOC_ID = "d0000000-0000-4000-8000-000000000002"

beforeEach(() => {
  authMock.mockReset(); listDocumentsMock.mockReset(); getDocumentMock.mockReset()
  deleteDocumentMock.mockReset(); deleteStatementFileMock.mockReset(); signStatementDownloadMock.mockReset()
  recordAuditMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
})

describe("GET /api/admin/bookkeeping/documents", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await GET_LIST(new Request(`http://x/api?book_id=${BOOK}`) as never)
    expect(res.status).toBe(403)
    expect(listDocumentsMock).not.toHaveBeenCalled()
  })
  it("400s without book_id", async () => {
    const res = await GET_LIST(new Request("http://x/api") as never)
    expect(res.status).toBe(400)
  })
  it("returns documents for an admin", async () => {
    listDocumentsMock.mockResolvedValue([{ id: DOC_ID, storage_path: "bookkeeping/x.csv" }])
    const res = await GET_LIST(new Request(`http://x/api?book_id=${BOOK}`) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.documents).toEqual([{ id: DOC_ID, storage_path: "bookkeeping/x.csv" }])
    expect(listDocumentsMock).toHaveBeenCalledWith(BOOK)
  })
})

describe("DELETE /api/admin/bookkeeping/documents/[id]", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await DELETE(new Request("http://x/api") as never, { params: Promise.resolve({ id: DOC_ID }) })
    expect(res.status).toBe(403)
    expect(getDocumentMock).not.toHaveBeenCalled()
  })
  it("404s a missing document", async () => {
    getDocumentMock.mockResolvedValue(null)
    const res = await DELETE(new Request("http://x/api") as never, { params: Promise.resolve({ id: DOC_ID }) })
    expect(res.status).toBe(404)
    expect(deleteStatementFileMock).not.toHaveBeenCalled()
    expect(deleteDocumentMock).not.toHaveBeenCalled()
  })
  it("deletes the storage object + row and audits, for an existing document", async () => {
    getDocumentMock.mockResolvedValue({ id: DOC_ID, storage_path: "bookkeeping/x.csv" })
    deleteStatementFileMock.mockResolvedValue(undefined)
    deleteDocumentMock.mockResolvedValue(undefined)
    const res = await DELETE(new Request("http://x/api") as never, { params: Promise.resolve({ id: DOC_ID }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })
    expect(deleteStatementFileMock).toHaveBeenCalledWith("bookkeeping/x.csv")
    expect(deleteDocumentMock).toHaveBeenCalledWith(DOC_ID)
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.document_deleted",
      category: "commerce",
      target: { type: "bookkeeping_document", id: DOC_ID },
    }))
  })
})

describe("GET /api/admin/bookkeeping/documents/[id]/download", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await GET_DOWNLOAD(new Request("http://x/api") as never, { params: Promise.resolve({ id: DOC_ID }) })
    expect(res.status).toBe(403)
    expect(getDocumentMock).not.toHaveBeenCalled()
  })
  it("404s a missing document", async () => {
    getDocumentMock.mockResolvedValue(null)
    const res = await GET_DOWNLOAD(new Request("http://x/api") as never, { params: Promise.resolve({ id: DOC_ID }) })
    expect(res.status).toBe(404)
    expect(signStatementDownloadMock).not.toHaveBeenCalled()
  })
  it("signs a download url and audits admin_read_sensitive", async () => {
    getDocumentMock.mockResolvedValue({ id: DOC_ID, storage_path: "bookkeeping/x.csv" })
    signStatementDownloadMock.mockResolvedValue("https://signed.example/x.csv")
    const res = await GET_DOWNLOAD(new Request("http://x/api") as never, { params: Promise.resolve({ id: DOC_ID }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ url: "https://signed.example/x.csv" })
    // 1-hour TTL: the review previews park longer than the old 5-minute
    // default; expired links rendered ExpiredToken errors in the dialog.
    expect(signStatementDownloadMock).toHaveBeenCalledWith("bookkeeping/x.csv", 3600)
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.document_downloaded",
      category: "admin_read_sensitive",
      target: { type: "bookkeeping_document", id: DOC_ID },
    }))
  })
  it("redirect=1 302-redirects to a freshly signed url (durable href for new-tab opens)", async () => {
    getDocumentMock.mockResolvedValue({ id: DOC_ID, storage_path: "bookkeeping/x.pdf" })
    signStatementDownloadMock.mockResolvedValue("https://signed.example/x.pdf")
    const res = await GET_DOWNLOAD(new Request("http://x/api?redirect=1") as never, { params: Promise.resolve({ id: DOC_ID }) })
    // A 302 per hit means the link in a tab/history/bookmark can never rot —
    // every open mints a fresh signature (the 2026-08-03 ExpiredToken report
    // came from a raw signed GCS URL reopened after its TTL).
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("https://signed.example/x.pdf")
    expect(signStatementDownloadMock).toHaveBeenCalledWith("bookkeeping/x.pdf", 3600)
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.document_downloaded",
    }))
  })
})
