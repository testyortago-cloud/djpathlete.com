import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * AI Bookkeeper Phase 3, Task 13 — Amazon CSV import routes.
 *
 * Mirrors receipts-upload.test.ts's mocking shape: createGenerationLog lives
 * in @/lib/db/ai-generation-log (NOT @/lib/ai/generation-log — that module
 * doesn't exist), and firebase-admin/firestore is mocked directly since the
 * upload route imports FieldValue from it. parseAmazonCsv is NOT mocked —
 * it's a pure parser and the whole point of these tests is proving the real
 * amazon:<orderId>:<lineIndex> refs come out the other end in input order.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  findDocumentBySha256: vi.fn().mockResolvedValue(null),
  createDocument: vi.fn().mockResolvedValue({ id: "d1" }),
  listAccounts: vi.fn().mockResolvedValue([{ id: "a1", name: "Equipment", account_type: "expense", service_line: null }]),
  getBook: vi.fn().mockResolvedValue({ id: "b1", name: "Darren", book_kind: "business" }),
  assertAccountsInBook: vi.fn(),
  insertAmazonEntries: vi.fn().mockResolvedValue({ inserted: 1 }),
  linkDocumentBatch: vi.fn(),
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
import { createDocument, insertAmazonEntries, linkDocumentBatch } from "@/lib/db/bookkeeping"
import { POST as UPLOAD } from "@/app/api/admin/bookkeeping/receipts/amazon/route"
import { POST as COMMIT } from "@/app/api/admin/bookkeeping/receipts/amazon/commit/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const admin = { user: { id: UUID, role: "admin" } }
const ORIGINAL_BUCKET = process.env.FIREBASE_PRIVATE_BUCKET

const body = (b: unknown) => ({ json: async () => b }) as unknown as Request

function form(csv: string, name = "orders.csv", type = "text/csv", bookId = UUID) {
  const fd = new FormData()
  fd.set("book_id", bookId)
  fd.set("file", new File([csv], name, { type }))
  return { formData: async () => fd } as unknown as Request
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  process.env.FIREBASE_PRIVATE_BUCKET = "bucket"
})
afterEach(() => {
  process.env.FIREBASE_PRIVATE_BUCKET = ORIGINAL_BUCKET
})

const AMAZON_CSV = "Order Date,Order ID,Title,Item Total\n2026-07-01,112-1,Bands,$24.99"

describe("POST /api/admin/bookkeeping/receipts/amazon", () => {
  it("parses Amazon rows and returns refs in input order, storing a kind:receipt document", async () => {
    const res = await UPLOAD(form(AMAZON_CSV))
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json).toMatchObject({ jobId: "job1", documentId: "d1", log_id: "log1" })
    expect(json.refs).toEqual(["amazon:112-1:0"])

    expect((createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      kind: "receipt",
      mime_type: "text/csv",
    })

    expect(jobSet).toHaveBeenCalledTimes(1)
    const jobPayload = jobSet.mock.calls[0][0]
    expect(jobPayload.type).toBe("statement_import")
    expect(jobPayload.input.kind).toBe("csv_structured")
    expect(jobPayload.input.rows).toEqual([
      { ref: "amazon:112-1:0", occurred_on: "2026-07-01", description: "Bands", amount_cents: 2499, direction: "expense" },
    ])
    expect(jobPayload.input.accounts).toEqual([{ id: "a1", name: "Equipment", account_type: "expense", service_line: null }])
  })

  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "client" } })
    expect((await UPLOAD(form(AMAZON_CSV))).status).toBe(403)
  })

  it("rejects a non-CSV file", async () => {
    const res = await UPLOAD(form(AMAZON_CSV, "orders.pdf", "application/pdf"))
    expect(res.status).toBe(400)
  })

  it("400 when the CSV parses to zero rows", async () => {
    const res = await UPLOAD(form("not,amazon,columns\n1,2,3"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(typeof json.error).toBe("string")
  })
})

describe("POST /api/admin/bookkeeping/receipts/amazon/commit", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "client" } })
    const res = await COMMIT(body({ book_id: UUID, entries: [] }))
    expect(res.status).toBe(403)
  })

  it("400 on a non-amazon source_ref", async () => {
    const res = await COMMIT(
      body({
        book_id: UUID,
        document_id: UUID,
        entries: [
          {
            direction: "expense",
            amount_cents: 100,
            occurred_on: "2026-07-01",
            memo: "x",
            counterparty: "Amazon",
            service_line: null,
            source: "receipt",
            source_ref: "receipt:xyz",
          },
        ],
      }),
    )
    expect(res.status).toBe(400)
    expect(insertAmazonEntries).not.toHaveBeenCalled()
  })

  it("200 happy path: posts entries and links the document batch", async () => {
    const res = await COMMIT(
      body({
        book_id: UUID,
        document_id: UUID,
        entries: [
          {
            direction: "expense",
            amount_cents: 2499,
            occurred_on: "2026-07-01",
            memo: "Bands",
            counterparty: "Amazon",
            service_line: null,
            source: "receipt",
            source_ref: "amazon:112-1:0",
            account_id: UUID,
          },
        ],
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ inserted: 1 })
    expect(typeof json.batchId).toBe("string")

    expect((insertAmazonEntries as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual(json.batchId)
    expect((insertAmazonEntries as ReturnType<typeof vi.fn>).mock.calls[0][2]).toMatchObject([
      { source_ref: "amazon:112-1:0", amount_cents: 2499, account_id: UUID },
    ])
    expect(linkDocumentBatch).toHaveBeenCalledWith(UUID, UUID, json.batchId, 1)
  })
})
