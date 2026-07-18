import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * AI Bookkeeper Phase 3, Task 11 — receipt image upload route.
 *
 * Mirrors __tests__/api/admin/bookkeeping/statement-import.test.ts's mocking
 * shape: createGenerationLog lives in @/lib/db/ai-generation-log (NOT
 * @/lib/ai/generation-log — that module doesn't exist), and firebase-admin/
 * firestore is mocked directly since the route imports FieldValue from it.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  findDocumentBySha256: vi.fn().mockResolvedValue(null),
  createDocument: vi.fn().mockResolvedValue({ id: "d1" }),
  listAccounts: vi.fn().mockResolvedValue([{ id: "a1", name: "Equipment", account_type: "expense", service_line: null }]),
  getBook: vi.fn().mockResolvedValue({ id: "b1", name: "Darren", book_kind: "business" }),
}))
vi.mock("@/lib/bookkeeping/documents", () => ({ storeStatementFile: vi.fn(), safeStatementName: (n: string) => n }))
vi.mock("@/lib/db/ai-generation-log", () => ({ createGenerationLog: vi.fn().mockResolvedValue({ id: "log1" }) }))
const { jobSet } = vi.hoisted(() => ({ jobSet: vi.fn() }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ id: "job1", set: jobSet }) }) }),
  getAdminRtdb: () => ({ ref: () => ({ set: vi.fn() }) }),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "ts" } }))

import { auth } from "@/lib/auth"
import { createDocument } from "@/lib/db/bookkeeping"
import { POST } from "@/app/api/admin/bookkeeping/receipts/upload/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const ORIGINAL_BUCKET = process.env.FIREBASE_PRIVATE_BUCKET
beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "admin" } })
  process.env.FIREBASE_PRIVATE_BUCKET = "bucket"
})
afterEach(() => {
  process.env.FIREBASE_PRIVATE_BUCKET = ORIGINAL_BUCKET
})

function form(fileBytes = "JPEGDATA", type = "image/jpeg", name = "r.jpg", bookId = UUID) {
  const fd = new FormData()
  fd.set("book_id", bookId)
  fd.set("file", new File([fileBytes], name, { type }))
  return { formData: async () => fd } as unknown as Request
}

describe("POST /api/admin/bookkeeping/receipts/upload", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "client" } })
    expect((await POST(form())).status).toBe(403)
  })

  it("rejects a non-image type", async () => {
    const res = await POST(form("x", "application/zip", "r.zip"))
    expect(res.status).toBe(400)
  })

  it("rejects an invalid book_id", async () => {
    const res = await POST(form("JPEGDATA", "image/jpeg", "r.jpg", "not-a-uuid"))
    expect(res.status).toBe(400)
  })

  it("stores a receipt document + returns 202 with job ids", async () => {
    const res = await POST(form())
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json).toMatchObject({ jobId: "job1", documentId: "d1", log_id: "log1" })
    expect((createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ kind: "receipt" })

    expect(jobSet).toHaveBeenCalledTimes(1)
    const jobPayload = jobSet.mock.calls[0][0]
    expect(jobPayload.type).toBe("receipt_scan")
    expect(jobPayload.input).toMatchObject({
      mimeType: "image/jpeg",
      accounts: [{ name: "Equipment", account_type: "expense" }],
      bookName: "Darren",
      bookKind: "business",
      documentId: "d1",
      logId: "log1",
      requestedBy: UUID,
    })
    expect(typeof jobPayload.input.storagePath).toBe("string")
    expect(jobPayload.input.storagePath).toContain("bookkeeping/receipts/")
  })

  it("returns 500 with a friendly error and skips document creation when storage is unconfigured", async () => {
    delete process.env.FIREBASE_PRIVATE_BUCKET
    const res = await POST(form())
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/not configured/i)
    expect(createDocument).not.toHaveBeenCalled()
  })
})
